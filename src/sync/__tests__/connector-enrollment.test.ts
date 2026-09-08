const recoveryStorage = vi.hoisted(() => new Map());
vi.mock("idb-keyval", () => ({ createStore: () => ({}), get: async (key: string) => structuredClone(recoveryStorage.get(key)), set: async (key: string, value: unknown) => { recoveryStorage.set(key, structuredClone(value)); } }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@powersync/web", () => ({ UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" }, access_token: "token" } } }) },
  functions: { invoke: mock.invoke }, rpc: mock.rpc,
  from: () => ({ upsert: mock.upsert, update: mock.update, delete: () => ({ eq: async () => ({ error: null }) }) }),
} }));
vi.mock("../config", () => ({ POWERSYNC_URL: "https://example.invalid" }));
import { SupabaseConnector } from "../connector";
const put = (id: string, fields = {}) => ({ id, table: "notes", op: "PUT", opData: { user_id: "user-1", source_app: null, ...fields } });
function db(crud: unknown[]) {
  const complete = vi.fn();
  return { complete, database: { getNextCrudTransaction: async () => ({ crud, complete }) } };
}
beforeEach(() => {
  recoveryStorage.clear();
  localStorage.clear();
  mock.upsert.mockReset().mockResolvedValue({ error: null });
  mock.update.mockReset().mockReturnValue({ eq: async () => ({ error: null }) });
  mock.invoke.mockReset().mockResolvedValue({ data: { queued: true }, error: null });
  mock.rpc.mockReset().mockResolvedValue({ data: { id: "offline-note" }, error: null });
});
describe("offline capture enrollment", () => {
  it("retains upload on a server enrollment failure without discarding the note", async () => {
    mock.rpc.mockResolvedValueOnce({ error: { code: "40001", message: "capture enrollment unavailable" } });
    const { database, complete } = db([put("offline-note")]);
    await expect(new SupabaseConnector().uploadData(database as never)).rejects.toMatchObject({ code: "40001" });
    expect(complete).not.toHaveBeenCalled();
    expect(mock.upsert).not.toHaveBeenCalled();
  });
  it("acknowledges a receipt for a remotely deleted capture without uploading its body again", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: null });
    const { database, complete } = db([put("offline-note")]);
    await new SupabaseConnector().uploadData(database as never);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("retains the local transaction until the atomic remote capture succeeds, regardless of localStorage", async () => {
    mock.rpc.mockResolvedValueOnce({ error: new Error("network failure") });
    const { database, complete } = db([put("offline-note")]);
    await expect(new SupabaseConnector().uploadData(database as never)).rejects.toThrow("network failure");
    expect(complete).not.toHaveBeenCalled();
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
  it("commits subscription and note in one request before acknowledging upload", async () => {
    const { database, complete } = db([put("offline-note", { tags: '["tag"]', metadata: '{}', is_favorite: 1, updated_at: 'device time' })]);
    await new SupabaseConnector().uploadData(database as never);
    expect(mock.rpc).toHaveBeenCalledWith("capture_note_with_lexicon", { _note: { id: "offline-note", user_id: "user-1", source_app: null, tags: ["tag"], metadata: {}, is_favorite: true } });
    expect(mock.rpc.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it.each([{ source_app: "hub" }, { source_app: "import" }, { is_external: 1 }, { ai_visibility: "hidden" }, { is_trashed: 1 }])("does not enroll excluded capture %j", async (fields) => {
    const { database, complete } = db([put("excluded-note", fields)]);
    await new SupabaseConnector().uploadData(database as never);
    expect(mock.upsert).toHaveBeenCalledTimes(1);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("does not add a second enrollment request after later edits or deletion", async () => {
    const { database, complete } = db([put("offline-note"), { id: "offline-note", table: "notes", op: "PATCH", opData: { content: "final revision" } }, { id: "offline-note", table: "notes", op: "DELETE" }]);
    await new SupabaseConnector().uploadData(database as never);
    expect(mock.update).toHaveBeenCalledWith({ content: "final revision" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("never enrolls historical PATCH uploads", async () => {
    const later = db([{ id: "historical-note", table: "notes", op: "PATCH", opData: { content: "later revision" } }]);
    await new SupabaseConnector().uploadData(later.database as never);
    expect(later.complete).toHaveBeenCalledTimes(1);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
