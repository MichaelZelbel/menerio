// Smart Markdown chunker for the RAG pipeline.
//
// Splits an Obsidian-flavoured Markdown document into semantically meaningful
// chunks while keeping headings, code fences and tables intact. Each chunk
// carries the heading path of its surrounding section so it can be embedded
// with rich context.
//
// Tunables are exposed via ChunkOptions and have sensible defaults that
// roughly target ~800 tokens per chunk (≈3.2k chars), with a 200-token floor
// and a 1.2k-token ceiling.

export interface ChunkOptions {
  /** Target chunk size in tokens. */
  targetTokens?: number;
  /** Hard maximum tokens per chunk before forcing a split. */
  maxTokens?: number;
  /** Minimum tokens before a chunk is merged into a neighbour. */
  minTokens?: number;
  /** Sentences from previous chunk to prepend for context continuity. */
  overlapSentences?: number;
}

export interface NoteChunk {
  index: number;
  content: string;
  /** e.g. "Friendship Strategy > Core Principles" */
  headingPath: string;
  tokenCount: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetTokens: 800,
  maxTokens: 1200,
  minTokens: 200,
  overlapSentences: 1,
};

/** Rough token estimate: 1 token ≈ 4 chars for English/German prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split into top-level blocks, preserving fenced code & tables. */
function splitBlocks(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  const flush = () => {
    if (buf.length === 0) return;
    const joined = buf.join("\n").replace(/\s+$/g, "");
    if (joined.trim()) blocks.push(joined);
    buf = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        // entering a fence — keep the previous block, start a new one
        flush();
        inFence = true;
        fenceMarker = marker;
        buf.push(line);
        continue;
      }
      if (inFence && line.trim().startsWith(fenceMarker)) {
        buf.push(line);
        flush();
        inFence = false;
        fenceMarker = "";
        continue;
      }
    }

    if (inFence) {
      buf.push(line);
      continue;
    }

    // Heading boundary (H1–H3) → start a new block
    if (/^#{1,3}\s/.test(line)) {
      flush();
      buf.push(line);
      continue;
    }

    // Horizontal rule → boundary
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      flush();
      continue;
    }

    // Blank line between paragraphs
    if (line.trim() === "") {
      if (buf.length > 0) flush();
      continue;
    }

    buf.push(line);
  }
  flush();
  return blocks;
}

/** Update the heading path stack from a heading line. */
function applyHeading(stack: string[], line: string): string[] {
  const m = line.match(/^(#{1,3})\s+(.*)$/);
  if (!m) return stack;
  const level = m[1].length;
  const title = m[2].trim();
  const next = stack.slice(0, level - 1);
  next[level - 1] = title;
  return next;
}

function headingPathString(stack: string[]): string {
  return stack.filter(Boolean).join(" > ");
}

/** Split a too-large block at paragraph then sentence boundaries. */
function splitLargeBlock(block: string, maxTokens: number): string[] {
  if (estimateTokens(block) <= maxTokens) return [block];
  const paras = block.split(/\n\n+/);
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    const candidate = cur ? `${cur}\n\n${p}` : p;
    if (estimateTokens(candidate) > maxTokens && cur) {
      flush();
      cur = p;
    } else {
      cur = candidate;
    }
  }
  flush();

  // If any piece is still too big, split at sentence boundaries.
  const final: string[] = [];
  for (const piece of out) {
    if (estimateTokens(piece) <= maxTokens) { final.push(piece); continue; }
    const sentences = piece.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/);
    let curS = "";
    for (const s of sentences) {
      const candidate = curS ? `${curS} ${s}` : s;
      if (estimateTokens(candidate) > maxTokens && curS) {
        final.push(curS.trim());
        curS = s;
      } else {
        curS = candidate;
      }
    }
    if (curS.trim()) final.push(curS.trim());
  }
  return final;
}

function trailingSentences(text: string, n: number): string {
  if (n <= 0) return "";
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/);
  return sentences.slice(-n).join(" ");
}

export function smartChunkMarkdown(
  markdown: string,
  options: ChunkOptions = {},
): NoteChunk[] {
  const opts = { ...DEFAULTS, ...options };
  const text = (markdown ?? "").trim();
  if (!text) return [];

  const blocks = splitBlocks(text);

  // Pass 1: walk blocks, track heading path, expand oversize blocks.
  type Section = { headingPath: string; content: string; tokens: number };
  const sections: Section[] = [];
  let stack: string[] = [];

  for (const block of blocks) {
    const firstLine = block.split("\n", 1)[0] ?? "";
    if (/^#{1,3}\s/.test(firstLine)) {
      stack = applyHeading(stack, firstLine);
      // include heading line in the block content
    }
    const pieces = splitLargeBlock(block, opts.maxTokens);
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      sections.push({
        headingPath: headingPathString(stack),
        content: trimmed,
        tokens: estimateTokens(trimmed),
      });
    }
  }

  // Pass 2: greedily merge neighbouring sections up to targetTokens, but never
  // cross a heading-path change unless the resulting chunk would still be tiny.
  const merged: Section[] = [];
  for (const s of sections) {
    const last = merged[merged.length - 1];
    if (!last) { merged.push({ ...s }); continue; }

    const samePath = last.headingPath === s.headingPath;
    const combined = last.tokens + s.tokens;

    if (
      (samePath && combined <= opts.targetTokens) ||
      (last.tokens < opts.minTokens && combined <= opts.maxTokens)
    ) {
      last.content = `${last.content}\n\n${s.content}`;
      last.tokens = combined;
      // Prefer the deeper heading path if the previous one was empty.
      if (!last.headingPath) last.headingPath = s.headingPath;
    } else {
      merged.push({ ...s });
    }
  }

  // Pass 3: build final chunks with overlap and filter trivial content.
  const chunks: NoteChunk[] = [];
  let prevContent = "";
  for (const s of merged) {
    const cleaned = s.content.replace(/[ \t]+\n/g, "\n").trim();
    if (cleaned.replace(/\W+/g, "").length < 12) continue;

    let body = cleaned;
    const overlap = trailingSentences(prevContent, opts.overlapSentences);
    if (overlap && !body.startsWith(overlap)) {
      body = `${overlap}\n\n${body}`;
    }

    chunks.push({
      index: chunks.length,
      content: body,
      headingPath: s.headingPath,
      tokenCount: estimateTokens(body),
    });
    prevContent = cleaned;
  }

  return chunks;
}

/** Build the embedding-ready text for a chunk: title + heading path + body. */
export function buildEmbeddingInput(
  noteTitle: string | null | undefined,
  chunk: NoteChunk,
): string {
  const parts: string[] = [];
  if (noteTitle && noteTitle.trim()) parts.push(`# ${noteTitle.trim()}`);
  if (chunk.headingPath) parts.push(`Section: ${chunk.headingPath}`);
  parts.push(chunk.content);
  return parts.join("\n\n");
}
