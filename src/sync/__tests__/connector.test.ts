import { describe, expect, it, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const update = vi.fn();
const del = vi.fn();

vi.mock("@powersync/web", () => ({
  UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => ({ eq: () => update(...a) }),
      delete: () => ({ eq: (...a: unknown[]) => del(...a) }),
    }),
  },
}));

vi.mock("../config", () => ({ POWERSYNC_URL: "https://example.invalid" }));

import { SupabaseConnector } from "../connector";

function put(id: string, opData: Record<string, unknown> = {}) {
  return { op: "PUT", table: "notes", id, opData };
}

function fakeDb(crud: unknown[], complete: () => void) {
  return {
    getNextCrudTransaction: async () => ({
      crud,
      complete: async () => complete(),
    }),
  };
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  update.mockReset().mockResolvedValue({ error: null });
  del.mockReset().mockResolvedValue({ error: null });
});

describe("SupabaseConnector.uploadData", () => {
  it("still attempts later ops after one op fails permanently", async () => {
    // op "b" hits a unique violation (23505) — permanent, never succeeds on a
    // retry. It must not take "c" down with it.
    upsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } })
      .mockResolvedValueOnce({ error: null });

    const complete = vi.fn();
    const db = fakeDb([put("a"), put("b"), put("c")], complete);

    await new SupabaseConnector().uploadData(db as never);

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("rethrows a retryable failure so PowerSync retries the transaction", async () => {
    upsert.mockResolvedValueOnce({ error: { code: "08006", message: "connection failure" } });
    const complete = vi.fn();
    const db = fakeDb([put("a")], complete);

    await expect(new SupabaseConnector().uploadData(db as never)).rejects.toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pending transaction", async () => {
    const db = { getNextCrudTransaction: async () => null };
    await new SupabaseConnector().uploadData(db as never);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("malformed JSON in a synced column", () => {
  it("is treated as permanent, so the queue drains instead of wedging", async () => {
    const complete = vi.fn();
    // `metadata` is a JSON column; a truncated value can never be parsed, so
    // retrying it forever would block every later edit behind it.
    const db = fakeDb(
      [put("a", { metadata: "{not json" }), put("b", { metadata: "{}" })],
      complete,
    );

    await new SupabaseConnector().uploadData(db as never);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1); // "a" never reached the network, "b" did
  });
});
