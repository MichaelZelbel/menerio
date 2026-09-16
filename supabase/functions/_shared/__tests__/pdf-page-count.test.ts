import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { countPdfPages } from "../pdf-page-count.ts";

const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

function plainPdf(pages: number): string {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  const leaves = Array.from({ length: pages }, (_, i) =>
    `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`).join("");
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n${leaves}%%EOF\n`;
}

describe("countPdfPages", () => {
  it("reads /Count from an uncompressed page tree", async () => {
    expect(await countPdfPages(enc(plainPdf(3)))).toBe(3);
    expect(await countPdfPages(enc(plainPdf(120)))).toBe(120);
  });

  it("reads /Count from inside a compressed object stream", async () => {
    const inner = Buffer.from("<< /Type /Catalog /Pages 2 0 R >> << /Type /Pages /Kids [3 0 R] /Count 75 >>", "latin1");
    const body = deflateSync(inner);
    const head = Buffer.from(`%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 2 /First 10 /Filter /FlateDecode /Length ${body.length} >>\nstream\n`, "latin1");
    const tail = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
    expect(await countPdfPages(new Uint8Array(Buffer.concat([head, body, tail])))).toBe(75);
  });

  it("returns null when no page information is visible", async () => {
    expect(await countPdfPages(enc("%PDF-1.7\nnothing readable here\n%%EOF"))).toBeNull();
  });
});
