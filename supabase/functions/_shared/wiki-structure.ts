/**
 * Shared structural rules for Lexicon (wiki) page markdown.
 *
 * The Lexicon used to accumulate one giant paragraph per page because synthesis
 * kept appending sentences to the end of the body. These helpers define the
 * required page shape, detect violations, and provide a deterministic repair
 * that never adds or removes facts.
 */

export const PARAGRAPH_MAX_WORDS = 80;
export const SECTION_MAX_WORDS = 250;
export const SENTENCES_PER_PARAGRAPH = 3;

export const WIKI_PAGE_TEMPLATE = `<one-sentence definition, plain text, no heading>

## Overview
2-4 short paragraphs, each at most ${PARAGRAPH_MAX_WORDS} words.

## Key facts
- one short line per fact

## <Descriptive topic sections, as many as needed>
Short paragraphs or bullets under descriptive H2 headings
(for example "## Projects", "## Preferences", "## Relationships").

## Open questions      (optional)
## Contradictions      (optional, only when sources conflict)`;

export type StructureReport = {
  chars: number;
  headingCount: number;
  hasHeadings: boolean;
  maxParagraphWords: number;
  maxSectionWords: number;
  longParagraphs: number;
  longSections: string[];
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** True for lines that must never be reflowed (lists, quotes, tables, headings, code fences). */
function isStructuralLine(line: string): boolean {
  return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||```|~~~|\[\^)/.test(line);
}

type Block = { text: string; structural: boolean };

function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    blocks.push({ text, structural: buffer.some(isStructuralLine) });
    buffer = [];
  };

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (/^\s*#{1,6}\s/.test(line)) {
      flush();
      blocks.push({ text: line.trim(), structural: true });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  // Split after . ! ? followed by whitespace + an uppercase-ish start, avoiding
  // common abbreviations and decimal numbers.
  const parts = flat.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [flat];
  const sentences: string[] = [];
  for (const raw of parts) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const previous = sentences[sentences.length - 1];
    // Re-join fragments produced by abbreviations like "e.g." or "Dr."
    if (previous && /(\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|No|Inc|Ltd|approx)\.|\b[A-Z]\.)$/.test(previous)) {
      sentences[sentences.length - 1] = `${previous} ${sentence}`;
      continue;
    }
    sentences.push(sentence);
  }
  return sentences;
}

/** Analyse a page's structural health. */
export function analyzeStructure(markdown: string): StructureReport {
  const source = (markdown || "").replace(/\r\n/g, "\n");
  const blocks = splitBlocks(source);
  const headingCount = blocks.filter((block) => /^#{1,6}\s/.test(block.text)).length;

  let maxParagraphWords = 0;
  let longParagraphs = 0;
  for (const block of blocks) {
    if (block.structural) continue;
    const words = countWords(block.text);
    if (words > maxParagraphWords) maxParagraphWords = words;
    if (words > PARAGRAPH_MAX_WORDS) longParagraphs += 1;
  }

  // Section = heading + everything until the next heading of the same-or-higher level.
  let maxSectionWords = 0;
  const longSections: string[] = [];
  let currentHeading = "(intro)";
  let currentWords = 0;
  const closeSection = () => {
    if (currentWords > maxSectionWords) maxSectionWords = currentWords;
    if (currentWords > SECTION_MAX_WORDS) longSections.push(currentHeading);
  };
  for (const block of blocks) {
    if (/^#{1,6}\s/.test(block.text)) {
      closeSection();
      currentHeading = block.text.replace(/^#{1,6}\s*/, "").trim() || "(untitled)";
      currentWords = 0;
      continue;
    }
    currentWords += countWords(block.text);
  }
  closeSection();

  return {
    chars: source.length,
    headingCount,
    hasHeadings: headingCount > 0,
    maxParagraphWords,
    maxSectionWords,
    longParagraphs,
    longSections,
  };
}

/** True when the page violates the readability contract and should be repaired. */
export function needsRestructure(markdown: string): boolean {
  const source = (markdown || "").trim();
  if (!source) return false;
  const report = analyzeStructure(source);
  if (report.chars < 400 && report.maxParagraphWords <= PARAGRAPH_MAX_WORDS) return false;
  if (!report.hasHeadings) return true;
  if (report.longParagraphs > 0) return true;
  if (report.maxSectionWords > SECTION_MAX_WORDS) return true;
  return false;
}

/**
 * Deterministic repair: split runaway paragraphs at sentence boundaries into
 * ~3-sentence paragraphs. Never adds, removes, or rewords any text.
 */
export function softStructure(markdown: string): string {
  const source = (markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) return "";

  const blocks = splitBlocks(source);
  const out: string[] = [];

  for (const block of blocks) {
    if (block.structural || countWords(block.text) <= PARAGRAPH_MAX_WORDS) {
      out.push(block.text);
      continue;
    }
    const sentences = splitSentences(block.text);
    if (sentences.length <= 1) {
      out.push(block.text);
      continue;
    }
    const paragraphs: string[] = [];
    let group: string[] = [];
    for (const sentence of sentences) {
      group.push(sentence);
      const groupWords = countWords(group.join(" "));
      if (group.length >= SENTENCES_PER_PARAGRAPH || groupWords >= PARAGRAPH_MAX_WORDS) {
        paragraphs.push(group.join(" "));
        group = [];
      }
    }
    if (group.length > 0) paragraphs.push(group.join(" "));
    out.push(paragraphs.join("\n\n"));
  }

  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fact fingerprint used to prove a reformat is lossless.
 * Captures wikilink slugs, numbers, and capitalised entity tokens.
 */
export function factFingerprint(markdown: string): Set<string> {
  const source = markdown || "";
  const tokens = new Set<string>();

  for (const match of source.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    tokens.add(`link:${match[1].trim().toLowerCase()}`);
  }
  for (const match of source.matchAll(/\d[\d.,:/-]*/g)) {
    const value = match[0].replace(/[.,:/-]+$/, "");
    if (value.length > 0) tokens.add(`num:${value}`);
  }
  const plain = source.replace(/\[\[[^\]]+\]\]/g, " ");
  for (const match of plain.matchAll(/\b[A-Z][A-Za-z0-9'’&-]{2,}\b/g)) {
    tokens.add(`ent:${match[0].toLowerCase()}`);
  }
  return tokens;
}

/** Tokens present before but missing after — any result means the rewrite lost facts. */
export function missingFacts(before: string, after: string): string[] {
  const beforeTokens = factFingerprint(before);
  const afterTokens = factFingerprint(after);
  const missing: string[] = [];
  for (const token of beforeTokens) {
    if (!afterTokens.has(token)) missing.push(token);
  }
  return missing;
}

/** Split a long page into LLM-sized chunks along paragraph boundaries. */
export function chunkMarkdown(markdown: string, maxChars = 9000): string[] {
  const blocks = splitBlocks((markdown || "").replace(/\r\n/g, "\n"));
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const block of blocks) {
    const length = block.text.length + 2;
    if (size + length > maxChars && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      size = 0;
    }
    current.push(block.text);
    size += length;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks.length > 0 ? chunks : [markdown];
}
