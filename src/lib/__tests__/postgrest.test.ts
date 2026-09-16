import { describe, it, expect } from "vitest";
import { escapeLike, pgOrValue, ilikeContains, fetchAllPages } from "../postgrest";

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

describe("fetchAllPages", () => {
  const source = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const page = (from: number, to: number) =>
    Promise.resolve({ data: source.slice(from, to + 1), error: null });

  it("reads past the 1,000-row cap until a short page", async () => {
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllPages<{ id: number }>((from, to) => {
      calls.push([from, to]);
      return page(from, to);
    });
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after one extra empty page when the total is an exact multiple", async () => {
    let n = 0;
    const rows = await fetchAllPages<{ id: number }>((from, to) => {
      n++;
      return Promise.resolve({ data: source.slice(0, 2000).slice(from, to + 1), error: null });
    });
    expect(rows).toHaveLength(2000);
    expect(n).toBe(3);
  });

  it("throws the query error instead of returning a partial list", async () => {
    await expect(
      fetchAllPages((from) =>
        Promise.resolve(from === 0 ? { data: source.slice(0, 1000), error: null } : { data: null, error: new Error("boom") }),
      ),
    ).rejects.toThrow("boom");
  });
});
