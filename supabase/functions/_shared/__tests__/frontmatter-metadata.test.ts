// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { encodeMenerioMetadata } from "../frontmatter";

/**
 * `menerio_metadata` as github-pull writes it. `btoa(JSON.stringify(meta))`
 * threw InvalidCharacterError on any character above U+00FF, so a note whose
 * AI summary held an en dash, a curly apostrophe or an emoji failed to sync.
 */
describe("encodeMenerioMetadata", () => {
  const meta = {
    summary: "Planning – “Q3” isn’t done 🚀",
    people: ["Юлия", "José"],
    topics: ["ai"],
  };

  it("encodes characters btoa refuses", () => {
    expect(() => btoa(JSON.stringify(meta))).toThrow();
    expect(() => encodeMenerioMetadata(meta)).not.toThrow();
  });

  it("is read back unchanged by the existing JSON.parse(atob(...))", () => {
    expect(JSON.parse(atob(encodeMenerioMetadata(meta)))).toEqual(meta);
  });

  it("is what github-pull writes, in both places", () => {
    const pull = readFileSync("supabase/functions/_shared/github-pull.ts", "utf8");
    expect(pull).not.toMatch(/btoa\(JSON\.stringify/);
    expect(pull.match(/encodeMenerioMetadata\(meta\)/g)?.length).toBe(2);
  });
});
