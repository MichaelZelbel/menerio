import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadProcessor } from "./note-ai-processing-harness";
import { createNoteAIJobs } from "../note-ai-jobs";
import { profileValueDecision } from "../profile-integrity";
import { changedProfileSubjects } from "../note-ai-processing";

// The current dedup trigger returns NULL for exact duplicates:
// migrations/20260815231856_1a3c2a1b-1245-479b-a6bb-fde01bfb25cb.sql:35-46.
// Execute the real preparation helper, Supabase query client and execution
// database error latch. Only the HTTP response is a synthetic PostgREST fixture.
function fixture(errorCode = "PGRST116") {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    // PostgREST returns a list unless the client requests exactly one object.
    if (errorCode === "PGRST116" && new Headers(init?.headers).get("Accept") !== "application/vnd.pgrst.object+json") {
      return new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      code: errorCode, details: errorCode === "PGRST116" ? "The result contains 0 rows" : "Fixture database failure",
      hint: null, message: "Fixture response",
    }), { status: errorCode === "PGRST116" ? 406 : 500, headers: { "Content-Type": "application/json" } });
  });
  const db = createClient("https://fixture.invalid", "fixture-key", { global: { fetch }, auth: { storageKey: `fixture-${errorCode}`, persistSession: false, autoRefreshToken: false } });
  const expose: any = {};
  loadProcessor({
    Deno: { env: { get: () => "" }, serve: () => {} }, createClient: () => db,
    createNoteAIJobs, profileValueDecision, expose,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }, "expose.prepare = prepareSuggestionForInsert; expose.execution = executionDatabase;");
  const suggestion = { suggestion_type: "add_profile_entry", user_id: "fixture-user", confidence_score: 1,
    payload: { category_id: "fixture-category", category_slug: "communication", label: "Email", value: "fixture@example.test", evidence_quote: "Fixture uses fixture@example.test" } };
  return { fetch, run: () => expose.execution.run("fixture-user", async () => {}, () => expose.prepare(suggestion, { mode: "auto", sensitivity: "balanced", autoAddSensitive: false })) };
}

describe("profile insert trigger suppression", () => {
  it("does not latch zero inserted rows as an outage or report a saved profile change", async () => {
    const f = fixture();
    const result = await f.run();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("pending_review");
    expect(result.target_entity_id).toBeUndefined();
    expect(changedProfileSubjects([result])).toEqual([]);
  });
  it("still latches a genuine database failure", async () => {
    const f = fixture("XX000");
    await expect(f.run()).rejects.toMatchObject({ kind: "transient" });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
