import { describe, expect, it, vi } from "vitest";
import { loadProcessor } from "./note-ai-processing-harness";
import { createNoteAIJobs, NoteAIJobError, classifyNoteAIError } from "../note-ai-jobs";
import { handleNoteAIRequest } from "../note-ai-processing";
import { profileValueDecision } from "../profile-integrity";
import { FactWritesPaused } from "../fact-store";

// The note pipeline's auto-applied profile facts go through the one write path
// (fact-store.ts writeFact) and nowhere else. The real preparation helper runs;
// writeFact is the boundary.
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const noTables = { from: () => { throw new Error("no table access expected"); } };

function fixture(writeFact: (...args: any[]) => Promise<any>) {
  const expose: any = {};
  const db = { rpc: async () => ({ data: true, error: null }), ...noTables };
  loadProcessor({
    Deno: { env: { get: () => "" }, serve: () => {} }, createClient: () => db,
    createNoteAIJobs, profileValueDecision, writeFact, expose, console: quiet,
  }, "expose.prepare = prepareSuggestionForInsert; expose.db = supabase;");
  const suggestion = (over: Record<string, unknown> = {}) => ({
    suggestion_type: "add_profile_entry", user_id: "fixture-user", source_note_id: "fixture-note", confidence_score: 1,
    payload: { contact_id: "fixture-contact", category_id: "fixture-category", category_slug: "communication", label: "Email",
      value: "fixture@example.test", evidence_quote: "Fixture uses fixture@example.test", ...over },
  });
  const prefs = { mode: "auto", sensitivity: "balanced", autoAddSensitive: false };
  return { expose, prepare: (over?: Record<string, unknown>) => expose.prepare(suggestion(over), prefs) };
}

describe("process-note auto-applied profile facts", () => {
  it("writes through writeFact as ai_note with the quote and the note as source", async () => {
    const writeFact = vi.fn(async () => ({ ok: true, facts: [{ attribute: "email", outcome: "inserted", claimId: "claim-1" }] }));
    const f = fixture(writeFact);
    const result = await f.prepare();
    expect(writeFact).toHaveBeenCalledTimes(1);
    const [db, userId, input, opts] = writeFact.mock.calls[0] as any[];
    expect(db).toBe(f.expose.db);
    expect(userId).toBe("fixture-user");
    expect(input).toMatchObject({
      subject: { type: "contact", id: "fixture-contact" },
      label: "Email", value: "fixture@example.test", categorySlug: "communication",
      origin: "ai_note", evidenceQuote: "Fixture uses fixture@example.test",
      sourceType: "note", sourceId: "fixture-note",
    });
    expect(opts).toEqual({ isHuman: false });
    expect(result).toMatchObject({ status: "auto_applied_unreviewed", target_entity_type: "claim", target_entity_id: "claim-1" });
  });

  it("files an owner fact under self", async () => {
    const writeFact = vi.fn(async () => ({ ok: true, facts: [{ attribute: "email", outcome: "inserted", claimId: "claim-1" }] }));
    await fixture(writeFact).prepare({ contact_id: null });
    expect((writeFact.mock.calls[0] as any[])[2].subject).toEqual({ type: "self", id: null });
  });

  it("keeps every claim of a split bag so a Revert can remove them all", async () => {
    const writeFact = vi.fn(async () => ({ ok: true, facts: [
      { attribute: "language", outcome: "inserted", claimId: "c1" },
      { attribute: "language", outcome: "inserted", claimId: "c2" },
    ] }));
    const result = await fixture(writeFact).prepare();
    expect(result.target_entity_id).toBe("c1");
    expect(result.payload.claim_ids).toEqual(["c1", "c2"]);
  });

  it.each(["already_recorded", "history_not_revived", "suppressed"])("drops a fact the store answers %s", async (outcome) => {
    const writeFact = vi.fn(async () => ({ ok: true, facts: [{ attribute: "email", outcome }] }));
    const result = await fixture(writeFact).prepare();
    expect(result.status).toBe("removed");
    expect(result.target_entity_id).toBeUndefined();
  });

  it("sends a refused write to review instead of losing it", async () => {
    const writeFact = vi.fn(async () => ({ ok: false, facts: [{ attribute: null, outcome: "rejected", reason: "contact_not_found" }] }));
    expect((await fixture(writeFact).prepare()).status).toBe("pending_review");
  });

  it("a pause that starts mid-note leaves the fact for review", async () => {
    const writeFact = vi.fn(async () => { throw new FactWritesPaused(); });
    expect((await fixture(writeFact).prepare()).status).toBe("pending_review");
  });

  it("a short quote waits for a human and never reaches the store", async () => {
    const writeFact = vi.fn();
    const result = await fixture(writeFact).prepare({ evidence_quote: "short" });
    expect(result.status).toBe("pending_review");
    expect(writeFact).not.toHaveBeenCalled();
  });
});

describe("process-note while fact writes are paused", () => {
  it("does not process the note and parks its job for a later retry", async () => {
    const failures: string[] = [];
    let balanceCalls = 0, paid = 0, reads = 0;
    const lease = { id: "j", user_id: "u", note_id: "n", lease_id: "l", pipeline: "analysis", desired_generation: 1, captured_generation: 1, fingerprint: "f",
      snapshot: { id: "n", user_id: "u", title: "Fixture title", content: "Fixture content text with several words", media: [] } };
    const db = {
      rpc: async (name: string, args: any) => {
        if (name === "fail_note_ai_job") failures.push(args._kind);
        return { data: name === "get_note_ai_job_snapshot" ? lease : true, error: null };
      },
      from: () => { reads++; throw new Error("no table access expected"); },
    };
    const paused = vi.fn(async () => true);
    const processor = loadProcessor({
      Deno: { env: { get: () => "" }, serve: () => {} }, createClient: () => db,
      createNoteAIJobs, NoteAIJobError, classifyNoteAIError, handleNoteAIRequest,
      factWritesPaused: paused,
      checkBalance: async () => { balanceCalls++; return { allowed: true }; },
      runChat: async () => { paid++; return {}; },
      console: quiet,
    });
    await expect(processor.processInBackground(lease, "Bearer service")).rejects.toMatchObject({ kind: "no_credit", message: "fact_writes_paused" });
    expect(paused).toHaveBeenCalledTimes(1);
    // 'no_credit' parks the job without spending an attempt; it is claimed again after the pause.
    expect(failures).toEqual(["no_credit"]);
    expect(balanceCalls).toBe(0);
    expect(paid).toBe(0);
    expect(reads).toBe(0);
  });
});
