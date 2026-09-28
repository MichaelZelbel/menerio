import { describe, expect, it } from "vitest";
import { loadProcessor } from "./note-ai-processing-harness";
import { createNoteAIJobs, NoteAIJobError, classifyNoteAIError } from "../note-ai-jobs";
import { handleNoteAIRequest } from "../note-ai-processing";
import * as canonical from "../profile-canonical-schema";
import * as fieldsRegistry from "../profile-fields-registry";
import * as skillGuard from "../profile-skill-guard";
import * as nameGuard from "../profile-name-guard";
import * as factGate from "../profile-fact-gate";
import * as dedup from "../profile-dedup";
import * as integrity from "../profile-integrity";
import * as relCanonical from "../relationship-canonical";
import * as adjudicator from "../relationship-adjudicator";
import { suppressionKey } from "../fact-store";
import { normalizeAttribute } from "../claims";

// generateProfileSuggestions reads what the page already shows from
// profile_facts (current rows) and the "never suggest again" rows, never from
// the retired profile table. Real extraction code; the model reply and the
// database are fixtures.
const owner = "fixture-user";
const note = "My email is fixture@example.test and my favourite food is ramen noodles.";
const reply = JSON.stringify({ facts: [
  { contact_name: "Fixture", category_slug: "communication", label: "Email", value: "fixture@example.test", source_quote: "My email is fixture@example.test" },
  { contact_name: "Fixture", category_slug: "food", label: "Favorite food", value: "ramen noodles", source_quote: "my favourite food is ramen noodles" },
], relationships: [] });

function run(opts: { current?: Array<{ contact_id: string | null; label: string; value: string }>; suppressed?: string[] }) {
  const queries: Array<{ table: string; filters: unknown[][] }> = [];
  const inserted: any[] = [];
  const lease = { id: "j", user_id: owner, note_id: "n", lease_id: "l", pipeline: "analysis", desired_generation: 1, captured_generation: 1, fingerprint: "f", snapshot: {} };
  const db = {
    rpc: async (name: string) => ({ data: name === "begin_note_ai_stage" ? { status: "started" } : name === "get_note_ai_job_snapshot" ? lease : true, error: null }),
    from: (table: string) => {
      const record = { table, filters: [] as unknown[][] };
      queries.push(record);
      let from = 0;
      const q: any = new Proxy({}, { get: (_t, method) => {
        if (method === "then") return (resolve: any, reject: any) => {
          const rows = table === "profile_facts" ? (opts.current ?? [])
            : table === "ai_suggestion_suppressions" ? (opts.suppressed ?? []).map((suppression_key) => ({ suppression_key }))
            : [];
          return Promise.resolve({ data: from === 0 ? rows : [], error: null }).then(resolve, reject);
        };
        return (...args: any[]) => {
          if (method === "insert") inserted.push(...(Array.isArray(args[0]) ? args[0] : [args[0]]));
          if (method === "range") from = args[0];
          if (["eq", "is", "in"].includes(String(method))) record.filters.push([method, ...args]);
          return q;
        };
      } });
      return q;
    },
  };
  const processor = loadProcessor({
    ...canonical, ...fieldsRegistry, ...skillGuard, ...nameGuard, ...factGate, ...dedup, ...integrity, ...relCanonical, ...adjudicator,
    Deno: { env: { get: () => "" }, serve: () => {} }, createClient: () => db,
    createNoteAIJobs, NoteAIJobError, classifyNoteAIError, handleNoteAIRequest,
    checkBalance: async () => ({ allowed: true }),
    runChat: async () => ({ content: reply }), parseModelJson: JSON.parse,
    profileExtractionContract: () => "", outputLanguageRule: () => "", PROCESS_NOTE_PROFILE_PROMPT: "fixture",
    loadProfileFields: async () => [],
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }, 'getSuggestionPreferences=async()=>({mode:"review",sensitivity:"balanced",profileLanguage:"en"});loadSelfContext=async()=>({enabled:false,aliases:new Set()});');
  const people = [{ name: "Fixture", canonical_name: "Fixture", is_self: true }];
  return processor.generateProfileSuggestions(owner, "n", "Fixture", note, people, {}, lease).then(() => ({ queries, inserted }));
}

describe("process-note fact dedup", () => {
  it("reads current facts from profile_facts, scoped to the user, and never the retired table", async () => {
    const { queries, inserted } = await run({});
    expect(queries.some((q) => q.table === "profile_entries")).toBe(false);
    const facts = queries.filter((q) => q.table === "profile_facts");
    expect(facts.length).toBeGreaterThan(0);
    for (const q of facts) {
      expect(q.filters).toContainEqual(["eq", "user_id", owner]);
      expect(q.filters).toContainEqual(["eq", "is_current", true]);
      expect(q.filters).toContainEqual(["eq", "subject_type", "self"]);
    }
    const sup = queries.find((q) => q.table === "ai_suggestion_suppressions" && q.filters.some((f) => f[1] === "suggestion_type" && f[2] === "claim"));
    expect(sup?.filters).toContainEqual(["eq", "user_id", owner]);
    const items = inserted.filter((r) => String(r.suggestion_type).endsWith("profile_entry") || r.suggestion_type === "unknown_profile_field");
    expect(items.map((r) => r.payload.value).sort()).toEqual(["fixture@example.test", "ramen noodles"]);
    expect(items.every((r) => r.status === "pending_review" && r.target_entity_type === "claim")).toBe(true);
  });

  it("does not suggest a value the page already shows", async () => {
    const { inserted } = await run({ current: [{ contact_id: null, label: "Email", value: "fixture@example.test" }] });
    const values = inserted.filter((r) => String(r.suggestion_type).endsWith("profile_entry") || r.suggestion_type === "unknown_profile_field").map((r) => r.payload.value);
    expect(values).toEqual(["ramen noodles"]);
  });

  it("does not suggest a value the user called wrong", async () => {
    const first = await run({});
    const item = first.inserted.find((r) => r.payload?.value === "ramen noodles");
    const key = suppressionKey({ type: "self", id: null }, normalizeAttribute(item.payload.label), "ramen noodles");
    const { inserted } = await run({ suppressed: [key] });
    const values = inserted.filter((r) => String(r.suggestion_type).endsWith("profile_entry") || r.suggestion_type === "unknown_profile_field").map((r) => r.payload.value);
    expect(values).toEqual(["fixture@example.test"]);
  });
});
