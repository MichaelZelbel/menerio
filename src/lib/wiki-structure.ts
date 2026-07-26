/**
 * Client-side mirror of the Lexicon structural rules used by the edge functions
 * (`supabase/functions/_shared/wiki-structure.ts`). Render-time safety net so a
 * legacy wall-of-text page is still readable before it is backfilled.
 */

export const PARAGRAPH_MAX_WORDS = 80;
export const SENTENCES_PER_PARAGRAPH = 3;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function isStructuralLine(line: string): boolean {
  return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||```|~~~)/.test(line);
}

type Block = { text: string; structural: boolean };

function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    blocks.push({ text: buffer.join("\n"), structural: buffer.some(isStructuralLine) });
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
  const parts = flat.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [flat];
  const sentences: string[] = [];
  for (const raw of parts) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const previous = sentences[sentences.length - 1];
    if (previous && /(\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|No|Inc|Ltd|approx)\.|\b[A-Z]\.)$/.test(previous)) {
      sentences[sentences.length - 1] = `${previous} ${sentence}`;
      continue;
    }
    sentences.push(sentence);
  }
  return sentences;
}

/** Split over-long prose blocks into short paragraphs. Never touches lists, quotes, code or headings. */
export function softStructure(markdown: string): string {
  const source = (markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) return "";

  const out: string[] = [];
  for (const block of splitBlocks(source)) {
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
      if (group.length >= SENTENCES_PER_PARAGRAPH || countWords(group.join(" ")) >= PARAGRAPH_MAX_WORDS) {
        paragraphs.push(group.join(" "));
        group = [];
      }
    }
    if (group.length > 0) paragraphs.push(group.join(" "));
    out.push(paragraphs.join("\n\n"));
  }

  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
