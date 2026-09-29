import { describe, expect, it } from "vitest";
import { loadProcessor } from "./note-ai-processing-harness";
import { createNoteAIJobs, NoteAIJobError, classifyNoteAIError } from "../note-ai-jobs";
import { handleNoteAIRequest } from "../note-ai-processing";
import { profileValueDecision } from "../profile-integrity";
import { PostgrestClient } from "@supabase/postgrest-js";

// The real preparation helper, the real writeFact and the real execution
// database (with the options process-note builds it with). Only the tables are
// fixtures.
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const lease = {
  id: "j", user_id: "fixture-user", note_id: "fixture-note", lease_id: "l", pipeline: "analysis",
  desired_generation: 1, captured_generation: 1, fingerprint: "f",
  snapshot: { id: "fixture-note", user_id: "fixture-user", title: "Fixture", content: "Fixture content text", media: [] },
};

function tables(claimInsert: { data: unknown; error: unknown }) {
  const writes: string[] = [];
  const failures: string[] = [];
  const rpc = async (name: string, args: any) => {
    if (name === "fail_note_ai_job") failures.push(args._kind);
    const data = name === "get_note_ai_job_snapshot" ? lease
      : name === "begin_note_ai_stage" ? { status: "started" }
      : name === "fact_today" ? "2026-09-29"
      : name === "fact_writes_paused" ? false
      : true;
    return { data, error: null };
  };
  const from = (table: string) => {
    let action = "select";
    const q: any = new Proxy({}, {
      get: (_t, key) => {
        if (key === "then") {
          return (resolve: any, reject: any) => {
            if (action !== "select") writes.push(`${table}.${action}`);
            const result = table === "claims" && action === "insert" ? claimInsert
              : table === "contacts" ? { data: { id: "fixture-contact" }, error: null }
              : { data: [], error: null };
            return Promise.resolve(result).then(resolve, reject);
          };
        }
        return () => {
          if (["insert", "update", "upsert", "delete"].includes(String(key))) action = String(key);
          return q;
        };
      },
    });
    return q;
  };
  return { db: { rpc, from }, writes, failures };
}

function processor(db: unknown, extra: Record<string, unknown> = {}) {
  const expose: any = {};
  let handler: ((req: Request) => Promise<Response>) | undefined;
  loadProcessor({
    Deno: { env: { get: (k: string) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? "service-key" : "") }, serve: (h: any) => { handler = h; } },
    createClient: () => db, createNoteAIJobs, NoteAIJobError, classifyNoteAIError, handleNoteAIRequest, profileValueDecision,
    expose, console: quiet, ...extra,
  }, "expose.prepare = prepareSuggestionForInsert; expose.execution = executionDatabase;");
  return { ...expose, handler: () => handler! };
}

const suggestion = {
  suggestion_type: "add_profile_entry", user_id: "fixture-user", source_note_id: "fixture-note", confidence_score: 1, is_sensitive: false,
  payload: { contact_id: "fixture-contact", category_slug: "preferences", label: "Pets", value: "None!", evidence_quote: "Pets: None! Never had any." },
};
const prefs = { mode: "auto", sensitivity: "balanced", autoAddSensitive: false };

describe("process-note and the claim guards", () => {
  it("a value the claim quality guard refuses is dropped, and the analysis job carries on", async () => {
    const { db, writes } = tables({ data: null, error: { code: "23514", message: "claim_quality_guard: the value is a placeholder or repeats the attribute (pets)" } });
    const p = processor(db);
    // Before: the proxy raised the refusal as a transient database failure and
    // remembered it, so the run failed here and on every retry of the note.
    const result = await p.execution.run("fixture-user", async () => {}, async () => {
      const prepared = await p.prepare(suggestion, prefs);
      await p.execution.db.from("review_queue").insert([prepared]);
      return prepared;
    });
    expect(writes).toContain("claims.insert");
    expect(writes).toContain("review_queue.insert");
    expect(result.status).toBe("removed");
  });

  it("an accepted value is still auto-applied through the same database", async () => {
    const { db } = tables({ data: { id: "claim-1" }, error: null });
    const p = processor(db);
    const result = await p.execution.run("fixture-user", async () => {}, () => p.prepare(suggestion, prefs));
    expect(result).toMatchObject({ status: "auto_applied_unreviewed", target_entity_type: "claim", target_entity_id: "claim-1" });
  });

  it("a real database failure on a claim still fails the job", async () => {
    const { db } = tables({ data: null, error: { code: "XX001", message: "fixture outage" } });
    const p = processor(db);
    await expect(p.execution.run("fixture-user", async () => {}, () => p.prepare(suggestion, prefs))).rejects.toMatchObject({ kind: "transient" });
  });
});

describe("process-note review-card lookups with a name holding ( ) or ,", () => {
  it("sends a well-formed quoted list, so the note's analysis does not fail on it", async () => {
    // The real supabase-js query builder; only the network is a fixture.
    const urls: URL[] = [];
    const client = new PostgrestClient("http://fixture/rest/v1", {
      fetch: async (input: any, init?: any) => {
        urls.push(new URL(String(input)));
        return init?.method === "GET" || !init?.method
          ? new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
          : new Response(null, { status: 201 });
      },
    });
    const rpc = async (name: string) => ({
      data: name === "get_note_ai_job_snapshot" ? lease : name === "begin_note_ai_stage" ? { status: "started" } : true,
      error: null,
    });
    const db = { from: (table: string) => client.from(table), rpc };
    const expose: any = {};
    loadProcessor({
      Deno: { env: { get: () => "" }, serve: () => {} }, createClient: () => db, createNoteAIJobs, NoteAIJobError, classifyNoteAIError, handleNoteAIRequest,
      expose, console: quiet,
      runChat: async () => ({ content: JSON.stringify({ verdicts: [{ name: "Dr. Weber (Hausarzt)", verdict: "real_person" }] }) }),
      parseModelJson: JSON.parse,
    }, 'expose.review = generateReviewItems; expose.execution = executionDatabase; getSuggestionPreferences = async () => ({ mode: "review", sensitivity: "balanced", personBlocklist: [] });');
    const content = "Termin bei Dr. Weber (Hausarzt) wegen der Impfung.";
    await expose.execution.run("fixture-user", async () => {}, () =>
      expose.review("fixture-user", "fixture-note", "Arzttermin", content, { people: ["Dr. Weber (Hausarzt)"], content_mode: "personal" }, lease));
    const lookup = urls.find((u) => u.pathname.endsWith("/review_queue") && u.searchParams.has("title"));
    expect(lookup?.searchParams.get("title")).toBe('in.("Add \\"Dr. Weber (Hausarzt)\\" to your People")');
    const suppressions = urls.find((u) => u.pathname.endsWith("/ai_suggestion_suppressions"));
    expect(suppressions?.searchParams.get("suppression_key")).toBe('in.("add_contact:contact:none:dr. weber (hausarzt)")');
  });
});

describe("process-note answers the drain worker in the statuses it maps", () => {
  it.each([
    ["INSUFFICIENT_CREDITS", 402, "no_credit"],
    ["BALANCE_UNAVAILABLE", 503, "transient"],
  ])("a plain %s from a paid stage answers %i, as the job was filed", async (message, status, kind) => {
    const { db, failures } = tables({ data: null, error: null });
    const p = processor(db, {
      shouldExtractFacts: () => true, checkBalance: async () => ({ allowed: true }), noteContentHash: () => "h",
      runChat: async () => { throw new Error(message); },
      PROCESS_NOTE_METADATA_PROMPT: "fixture", metadataFieldContract: () => "", sourceLanguageRule: () => "",
    });
    const response = await p.handler()(new Request("http://fixture/process-note", {
      method: "POST",
      headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" },
      body: JSON.stringify({ note_id: "fixture-note", execute: true, job_id: "j", lease_id: "l", user_id: "fixture-user" }),
    }));
    expect(failures).toEqual([kind]);
    // 500 made the worker file a second, "uncertain" failure and close its slot.
    expect(response.status).toBe(status);
  });
});
