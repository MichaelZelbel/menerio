import { describe, expect, it, vi } from "vitest";
import { createNoteAiWorkerHandler } from "../note-ai-worker-http";

describe("scheduled note worker HTTP boundary", () => {
  it("acknowledges the ten-second scheduler request before delayed execution finishes", async () => {
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    let background!: Promise<Response>;
    let first = true;
    const handler = createNoteAiWorkerHandler({
      authorized: async () => true,
      settings: async () => ({ enabled: true, user_ids: ["approved"] }),
      rpc: async () => { if (!first) return []; first = false; return [{ id: "job", user_id: "approved", note_id: "note", pipeline: "analysis", lease_id: "lease" }]; },
      execute: async () => { await done; return { status: 200, finished: true }; },
      background: (task) => { background = task; },
    });
    const response = await handler(new Request("https://fixture.invalid"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    complete();
    expect(await (await background).json()).toMatchObject({ finished: 1 });
  });
  it("claims only the approved account and executes a real claimed payload", async () => {
    const job = { id: "job", user_id: "approved", note_id: "note", pipeline: "analysis", lease_id: "lease" };
    let available = true;
    const rpc = vi.fn(async () => { if (available) { available = false; return [job]; } return []; });
    const execute = vi.fn(async () => ({ status: 200, finished: true }));
    const handler = createNoteAiWorkerHandler({ authorized: async () => true, settings: async () => ({ enabled: true, user_ids: ["approved"] }), rpc, execute });
    const response = await handler(new Request("https://fixture.invalid", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 1, finished: 1 });
    expect(rpc).toHaveBeenCalledWith("claim_note_ai_jobs", { _limit: 1, _lease_seconds: 300, _user_id: "approved" });
    expect(execute).toHaveBeenCalledWith(job);
  });
  it.each([null, { enabled: false, user_ids: null }, { enabled: true, user_ids: [] }])("leaves all work saved when configuration excludes execution", async (config) => {
    const rpc = vi.fn();
    const handler = createNoteAiWorkerHandler({ authorized: async () => true, settings: async () => config, rpc, execute: vi.fn() });
    expect(await (await handler(new Request("https://fixture.invalid"))).json()).toMatchObject({ disabled: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports an unreadable worker configuration as a database fault", async () => {
    const handler = createNoteAiWorkerHandler({ authorized: async () => true, settings: async () => { throw new Error("database down"); }, rpc: vi.fn(), execute: vi.fn() });
    expect((await handler(new Request("https://fixture.invalid"))).status).toBe(503);
  });
  it("refuses a body marker without scheduler authentication", async () => {
    const settings = vi.fn();
    const handler = createNoteAiWorkerHandler({ authorized: async () => false, settings, rpc: vi.fn(), execute: vi.fn() });
    const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: '{"cron":"drain-note-ai-jobs"}' }));
    expect(response.status).toBe(401);
    expect(settings).not.toHaveBeenCalled();
  });
});
