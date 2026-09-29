import { describe, expect, it } from "vitest";
import { MAX_MCP_RESULT_CHARS, flattenMcpContent, isAllowedMcpServerUrl } from "../mcp-client.ts";

describe("flattenMcpContent", () => {
  it("passes text blocks through", () => {
    expect(flattenMcpContent([{ type: "text", text: "one" }, { type: "text", text: "two" }])).toBe("one\ntwo");
  });

  it("replaces base64 image, audio and blob blocks with a placeholder", () => {
    const base64 = "A".repeat(2_000_000);
    const out = flattenMcpContent([
      { type: "text", text: "Screenshot taken" },
      { type: "image", data: base64, mimeType: "image/png" },
      { type: "audio", data: base64, mimeType: "audio/wav" },
      { type: "resource", resource: { uri: "file:///report.pdf", blob: base64 } },
    ]);
    expect(out).not.toContain("AAAA");
    expect(out).toContain("[image omitted (image/png)]");
    expect(out).toContain("[audio omitted (audio/wav)]");
    expect(out).toContain("[binary resource omitted: file:///report.pdf]");
  });

  it("caps an oversized result and says so", () => {
    const out = flattenMcpContent([{ type: "text", text: "x".repeat(MAX_MCP_RESULT_CHARS + 5000) }]);
    expect(out.length).toBeLessThan(MAX_MCP_RESULT_CHARS + 200);
    expect(out).toMatch(/\[Result truncated: 5000 more characters not shown\.\]$/);
  });

  it("returns an empty string for a result without content", () => {
    expect(flattenMcpContent(undefined)).toBe("");
  });
});

describe("isAllowedMcpServerUrl", () => {
  it("still refuses internal addresses", () => {
    expect(isAllowedMcpServerUrl("http://169.254.169.254/mcp")).toBe(false);
    expect(isAllowedMcpServerUrl("https://mcp.example.com/mcp")).toBe(true);
  });
});
