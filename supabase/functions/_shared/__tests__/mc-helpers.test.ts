import { describe, expect, it } from "vitest";
import { dbErrorResponse, isUuid, pickTypedFields, readJsonObject } from "../mc-helpers.ts";

const put = (body: string) => new Request("https://x.test/hub-api-notes/1", { method: "PUT", body });

describe("readJsonObject", () => {
  it("answers 400, not 500, for malformed JSON", async () => {
    const { error } = await readJsonObject(put("{not json"));
    expect(error?.status).toBe(400);
  });

  it("answers 400 for a body that is JSON but not an object", async () => {
    for (const raw of ["null", "[]", "42"]) {
      const { error } = await readJsonObject(put(raw));
      expect(error?.status).toBe(400);
    }
  });

  it("returns the object", async () => {
    const { body, error } = await readJsonObject(put('{"title":"t"}'));
    expect(error).toBeNull();
    expect(body).toEqual({ title: "t" });
  });
});

describe("pickTypedFields", () => {
  const spec = {
    title: "string",
    tags: "string-array",
    is_pinned: "boolean",
    metadata: "object",
    contact_id: "nullable-uuid",
    due_date: "nullable-date",
    contact_frequency_days: "nullable-positive-int",
  } as const;

  it("copies only present, well-typed fields", () => {
    const { updates, error } = pickTypedFields(
      { title: "a", tags: ["x"], is_pinned: false, contact_id: null, ignored: 1 },
      spec,
    );
    expect(error).toBeNull();
    expect(updates).toEqual({ title: "a", tags: ["x"], is_pinned: false, contact_id: null });
  });

  it("refuses a wrong type with 400 naming the field", async () => {
    const { error } = pickTypedFields({ tags: "x", due_date: "tomorrow", metadata: [] }, spec);
    expect(error?.status).toBe(400);
    const text = await error!.text();
    expect(text).toContain("tags");
    expect(text).toContain("due_date");
    expect(text).toContain("metadata");
  });

  it("refuses a non-uuid contact id and a zero frequency", () => {
    expect(pickTypedFields({ contact_id: "abc" }, spec).error?.status).toBe(400);
    expect(pickTypedFields({ contact_frequency_days: 0 }, spec).error?.status).toBe(400);
  });
});

describe("dbErrorResponse", () => {
  it("treats data exceptions and constraint violations as the caller's input", () => {
    expect(dbErrorResponse({ code: "22P02", message: "invalid input syntax" }).status).toBe(400);
    expect(dbErrorResponse({ code: "23514", message: "check violation" }).status).toBe(400);
  });

  it("treats anything else as a server error", () => {
    expect(dbErrorResponse({ code: "57014", message: "statement timeout" }).status).toBe(500);
    expect(dbErrorResponse({ message: "fetch failed" }).status).toBe(500);
  });
});

describe("isUuid", () => {
  it("accepts any 8-4-4-4-12 hex id and nothing else", () => {
    expect(isUuid("0190f3a2-7b1c-7d2e-9f00-1234567890ab")).toBe(true);
    expect(isUuid("sync-status")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
