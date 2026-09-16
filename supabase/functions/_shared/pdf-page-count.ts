/**
 * Count the pages of a PDF without a PDF library, so OCR can be capped BEFORE
 * the provider bills for pages.
 *
 * Mistral OCR bills per processed page and accepts a `pages` selection, but it
 * has to be told which pages exist: asking for pages past the end of a short
 * document is not something to rely on. So the page count is read from the
 * file itself. The page tree root carries `/Type /Pages ... /Count N`; in
 * PDF 1.5+ files that dictionary often sits inside a compressed object stream,
 * so FlateDecode object streams are inflated and searched too.
 *
 * Returns null when no count can be found. The caller decides what an unknown
 * count means; it is never guessed here.
 */

const PAGES_COUNT = /\/Type\s*\/Pages\b[^]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^]*?\/Type\s*\/Pages\b/g;
const LEAF_PAGE = /\/Type\s*\/Page(?![a-zA-Z])/g;

function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Largest `/Count` of any `/Type /Pages` dictionary (the root holds the total). */
function scan(text: string): { count: number | null; leaves: number } {
  let count: number | null = null;
  // Look only inside single dictionaries, so a /Count from a neighbouring object
  // is never paired with an unrelated /Type /Pages.
  for (const dict of text.match(/<<(?:(?!<<|>>)[^])*>>/g) ?? []) {
    PAGES_COUNT.lastIndex = 0;
    const m = PAGES_COUNT.exec(dict);
    if (!m) continue;
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && (count === null || n > count)) count = n;
  }
  const leaves = (text.match(LEAF_PAGE) ?? []).length;
  return { count, leaves };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Response(bytes.slice()).body!.pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  const text = latin1(bytes);
  let { count, leaves } = scan(text);
  if (count !== null) return count;

  // Compressed object streams: `<< /Type /ObjStm ... /Filter /FlateDecode ... >> stream ... endstream`.
  const objStm = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = objStm.exec(text)) !== null) {
    const dict = m[1];
    if (!/\/Type\s*\/ObjStm/.test(dict) || !/\/FlateDecode/.test(dict)) continue;
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end === -1) break;
    // Prefer the declared length; an indirect length (`/Length 12 0 R`) falls
    // back to the bytes before `endstream` minus its end-of-line marker.
    const declared = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let stop = declared ? Math.min(start + Number(declared[1]), end) : end;
    if (!declared && text[stop - 1] === "\n") stop -= 1;
    if (!declared && text[stop - 1] === "\r") stop -= 1;
    const inflated = await inflate(bytes.subarray(start, stop));
    if (!inflated) continue;
    const inner = scan(latin1(inflated));
    if (inner.count !== null && (count === null || inner.count > count)) count = inner.count;
    leaves += inner.leaves;
    objStm.lastIndex = end;
  }
  if (count !== null) return count;
  return leaves > 0 ? leaves : null;
}
