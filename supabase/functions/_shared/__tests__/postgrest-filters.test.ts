import { describe, expect, it } from "vitest";
import {
  escapeLike,
  pgOrValue,
  ilikeContains,
  ilikeAnyColumn,
} from "../postgrest-filters.ts";

describe("escapeLike", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\path")).toBe("c:\\\\path");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });
});

describe("pgOrValue", () => {
  it("quotes values containing the or() grammar", () => {
    expect(pgOrValue("a,b")).toBe('"a,b"');
    expect(pgOrValue("Q1 (draft)")).toBe('"Q1 (draft)"');
  });

  it("escapes quotes and backslashes", () => {
    expect(pgOrValue('a"b')).toBe('"a\\"b"');
    expect(pgOrValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("ilikeContains", () => {
  it("survives a search term containing a comma", () => {
    // Unquoted, this became two conditions and PostgREST 400'd the request.
    expect(ilikeContains("title", "Smith, John")).toBe('title.ilike."%Smith, John%"');
  });

  it("survives brackets, which used to be silently stripped instead", () => {
    expect(ilikeContains("title", "Q1 (draft)")).toBe('title.ilike."%Q1 (draft)%"');
  });

  it("does not let a term's own wildcards change the match", () => {
    expect(ilikeContains("title", "100%")).toBe('title.ilike."%100\\\\%%"');
  });
});

describe("ilikeAnyColumn", () => {
  it("joins one fragment per column", () => {
    expect(ilikeAnyColumn(["title", "content"], "hi")).toBe(
      'title.ilike."%hi%",content.ilike."%hi%"',
    );
  });

  it("keeps the separator unambiguous when the term contains one", () => {
    const filter = ilikeAnyColumn(["title", "content"], "a,b");
    // Three commas in the string, but only the middle one separates conditions;
    // the other two are inside quoted values.
    expect(filter).toBe('title.ilike."%a,b%",content.ilike."%a,b%"');
  });
});
