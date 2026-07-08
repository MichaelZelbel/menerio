import { describe, it, expect } from "vitest";
import { escapeLike, pgOrValue, ilikeContains } from "../postgrest";

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\path")).toBe("c:\\\\path");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });
});

describe("pgOrValue", () => {
  it("quotes values so commas and parens are literal in the filter grammar", () => {
    expect(pgOrValue("a,b")).toBe('"a,b"');
    expect(pgOrValue("Q1 (draft)")).toBe('"Q1 (draft)"');
  });

  it("escapes internal backslashes and double quotes", () => {
    expect(pgOrValue('a"b')).toBe('"a\\"b"');
    expect(pgOrValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("ilikeContains", () => {
  it("builds a safe quoted ilike fragment", () => {
    expect(ilikeContains("title", "meeting")).toBe('title.ilike."%meeting%"');
  });

  it("neutralizes grammar-breaking commas in the search term", () => {
    // The comma is inside the quoted value, so PostgREST won't treat it as a
    // condition separator inside .or().
    expect(ilikeContains("title", "notes, agenda")).toBe('title.ilike."%notes, agenda%"');
  });

  it("keeps user wildcards literal while preserving the surrounding contains-globs", () => {
    // The user's % is escaped (\%) so it matches literally; the outer %…% remain wildcards.
    expect(ilikeContains("content", "100%")).toBe('content.ilike."%100\\\\%%"');
  });
});
