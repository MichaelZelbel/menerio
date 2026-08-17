import { describe, expect, it } from "vitest";
import { selectAllRows } from "../paged-select.ts";

describe("selectAllRows", () => {
  it("pages past the PostgREST row cap", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => ({ id: i }));
    const rows = await selectAllRows<{ id: number }>(
      async (from, to) => ({ data: all.slice(from, to + 1), error: null }),
      1000,
    );
    expect(rows).toHaveLength(2300);
    expect(rows[2299].id).toBe(2299);
  });

  it("stops on a short page", async () => {
    let calls = 0;
    const rows = await selectAllRows<{ id: number }>(async () => {
      calls += 1;
      return { data: [{ id: 1 }], error: null };
    }, 1000);
    expect(rows).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("handles an exact multiple of the page size without looping forever", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const rows = await selectAllRows<{ id: number }>(
      async (from, to) => ({ data: all.slice(from, to + 1), error: null }),
      1000,
    );
    expect(rows).toHaveLength(2000);
  });

  it("returns empty when there is nothing", async () => {
    const rows = await selectAllRows(async () => ({ data: [], error: null }), 1000);
    expect(rows).toEqual([]);
  });

  it("throws the underlying error rather than returning a short list", async () => {
    await expect(
      selectAllRows(async () => ({ data: null, error: { message: "boom" } }), 1000),
    ).rejects.toBeTruthy();
  });
});
