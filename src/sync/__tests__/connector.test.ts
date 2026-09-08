const recoveryStorage = vi.hoisted(() => new Map());
const storageFailure = vi.hoisted(() => ({ fail: false }));
vi.mock("idb-keyval", () => ({ createStore: () => ({}), get: async (key: string) => structuredClone(recoveryStorage.get(key)), set: async (key: string, value: unknown) => { if (storageFailure.fail) throw new Error("disk full"); recoveryStorage.set(key, structuredClone(value)); } }));
import { describe, expect, it, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const update = vi.fn();
const del = vi.fn();

vi.mock("@powersync/web", () => ({
  UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" }, access_token: "token" } } }) },
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => ({ eq: () => update(...a) }),
      delete: () => ({ eq: (...a: unknown[]) => del(...a) }),
    }),
  },
}));

vi.mock("../config", () => ({ POWERSYNC_URL: "https://example.invalid" }));

import { SupabaseConnector, classifySyncError } from "../connector";
import { readRecovery, preserveUploadsBeforeAccountClear } from "../recovery";

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
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, work: () => unknown) => work() } });
  recoveryStorage.clear();
  storageFailure.fail = false;
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


describe("durable recovery", () => {
  it("recovers unconfirmed uploads after an account change removes their PowerSync transaction", async () => {
    upsert.mockResolvedValueOnce({ error: null }).mockRejectedValueOnce(new Error("lost response"));
    const complete = vi.fn();
    const database = fakeDb([put("confirmed"), put("unconfirmed")], complete);
    await expect(new SupabaseConnector().uploadData(database as never)).rejects.toThrow("lost response");
    expect((await readRecovery("user-1")).some(batch => batch.status === "uploading")).toBe(true);

    // AuthProvider performs this durable step before disconnectAndClear.
    await preserveUploadsBeforeAccountClear("user-1");
    const emptyDatabase = { getNextCrudTransaction: async () => null };
    expect(await readRecovery("user-1")).toMatchObject([
      { status: "recovery", completed: 0, operations: [{ id: "unconfirmed" }] },
    ]);
    expect(await readRecovery("user-2")).toEqual([]);
    await new SupabaseConnector().uploadData(emptyDatabase as never);
    await new SupabaseConnector().retryRecovery();
    expect(upsert.mock.calls.map(call => call[0].id)).toEqual(["confirmed", "unconfirmed", "unconfirmed"]);
    expect(await readRecovery("user-1")).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("retains the transaction without a cross-tab lock", async () => {
    vi.stubGlobal("navigator", {});
    const complete = vi.fn();
    await expect(new SupabaseConnector().uploadData(fakeDb([put("saved")], complete) as never)).rejects.toThrow("Web Locks");
    expect(upsert).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await readRecovery("user-1")).toEqual([]);
  });

  it.each([["22P02", "data"], ["23505", "data"], ["42501", "permission"], ["42P01", "schema"], ["PGRST301", "auth"], ["08006", "transient"]])("classifies %s as %s", (code, kind) => {
    expect(classifySyncError({ code })).toBe(kind);
  });

  it.each(["22P02", "23505", "42501", "42P01"])("preserves %s through restart and uploads independent later edits", async code => {
    upsert.mockResolvedValueOnce({ error: { code } });
    const complete = vi.fn();
    await new SupabaseConnector("user-1").uploadData(fakeDb([put("bad"), put("good")], complete) as never);
    expect(complete).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledTimes(2);
    const batches = await readRecovery("user-1");
    expect(batches).toHaveLength(1);
    expect(batches[0].operations[0].id).toBe("bad");
    expect(await readRecovery("user-2")).toEqual([]);
    await new SupabaseConnector("user-1").retryRecovery();
    expect(await readRecovery("user-1")).toEqual([]);
  });

  it("keeps related operations together and preserves later edits to a rejected row", async () => {
    upsert.mockResolvedValueOnce({ error: { code: "22P02" } });
    await new SupabaseConnector().uploadData(fakeDb([put("bad"), { ...put("dependent"), opData: { related: '["bad"]' } }, put("good")], vi.fn()) as never);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect((await readRecovery("user-1"))[0].operations).toHaveLength(2);
    expect((await readRecovery("user-1"))[0].operations[0].id).toBe("bad");
    await new SupabaseConnector().uploadData(fakeDb([{ ...put("bad"), op: "PATCH", opData: { title: "later" } }, put("independent")], vi.fn()) as never);
    expect(update).not.toHaveBeenCalled();
    upsert.mockResolvedValueOnce({ error: { code: "22P02" } });
    await new SupabaseConnector().retryRecovery();
    expect(update).not.toHaveBeenCalled();
    await new SupabaseConnector().retryRecovery();
    expect(update).toHaveBeenCalledOnce();
  });

  it("quarantines same-row dependent operations without uploading them", async () => {
    upsert.mockResolvedValueOnce({ error: { code: "23505" } });
    await new SupabaseConnector().uploadData(fakeDb([put("bad"), { ...put("bad"), op: "PATCH", opData: { title: "later" } }, put("good")], vi.fn()) as never);
    expect(update).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect((await readRecovery("user-1"))[0].operations).toHaveLength(2);
  });

  it.each([{ code: "PGRST301" }, new Error("network failure")])("retains transient/auth failures without acknowledging", async error => {
    upsert.mockResolvedValueOnce({ error });
    const complete = vi.fn();
    await expect(new SupabaseConnector().uploadData(fakeDb([put("bad")], complete) as never)).rejects.toBe(error);
    expect(complete).not.toHaveBeenCalled();
    expect((await readRecovery("user-1"))[0].status).toBe("uploading");
  });

  it("does not replay confirmed operations when a later operation loses its response", async () => {
    const complete = vi.fn();
    const database = fakeDb([put("first"), put("second")], complete);
    upsert.mockResolvedValueOnce({ error: null }).mockRejectedValueOnce(new Error("lost response"));
    await expect(new SupabaseConnector().uploadData(database as never)).rejects.toThrow("lost response");
    await new SupabaseConnector().uploadData(database as never);
    expect(upsert.mock.calls.map(call => call[0].id)).toEqual(["first", "second", "second"]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("refuses to use another account's connector", async () => {
    await expect(new SupabaseConnector("user-2").uploadData(fakeDb([put("private")], vi.fn()) as never)).rejects.toMatchObject({ status: 401 });
    expect(upsert).not.toHaveBeenCalled();
  });
});

 it("does not acknowledge or upload if the durable store cannot commit", async () => {
   storageFailure.fail = true;
   const complete = vi.fn();
   await expect(new SupabaseConnector().uploadData(fakeDb([put("saved")], complete) as never)).rejects.toThrow("disk full");
   expect(complete).not.toHaveBeenCalled();
   expect(upsert).not.toHaveBeenCalled();
 });
