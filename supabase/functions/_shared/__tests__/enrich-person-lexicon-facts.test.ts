import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileValueDecision } from "../profile-integrity";

// "Enrich from notes & timeline" writes its auto-applied facts through the one
// write path, as ai_lexicon with the verbatim quote. The real Edge function
// body runs; writeFact is the boundary.
const writeFact = vi.fn();
function load() {
  const bindings: Record<string, unknown> = {
    writeFact, profileValueDecision, CANONICAL_LABELS_FOR_PROMPT: "",
    createClient: () => ({}),
    Deno: { env: { get: () => "" }, serve: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  const source = readFileSync("supabase/functions/enrich-person-from-lexicon/index.ts", "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const code = ts.transpileModule(`${source}\nreturn { applyLexiconFact, enrichmentRefusal };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as {
    applyLexiconFact: (db: any, userId: string, s: any) => Promise<any>;
    enrichmentRefusal: (contact: Record<string, unknown>, hideSensitive: boolean) => string | null;
  };
}
const suggestion = (over: Record<string, unknown> = {}) => ({
  user_id: "fixture-user", suggestion_type: "add_profile_entry", status: "pending_review", confidence_score: 0.82,
  payload: { contact_id: "fixture-contact", category_slug: "location", category_id: null, label: "Current city", value: "Lisbon",
    evidence_quote: "She moved to Lisbon last year", source: "lexicon_enrichment", ...over },
});

describe("lexicon enrichment facts", () => {
  beforeEach(() => writeFact.mockReset());

  it("are written through writeFact as ai_lexicon with the quote", async () => {
    writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "current-city", outcome: "inserted", claimId: "claim-1" }] });
    const db = {};
    const result = await load().applyLexiconFact(db, "fixture-user", suggestion());
    expect(writeFact).toHaveBeenCalledWith(db, "fixture-user", expect.objectContaining({
      subject: { type: "contact", id: "fixture-contact" }, label: "Current city", value: "Lisbon",
      origin: "ai_lexicon", evidenceQuote: "She moved to Lisbon last year", sourceType: "lexicon",
    }), { isHuman: false });
    expect(result).toMatchObject({ status: "auto_applied_unreviewed", target_entity_type: "claim", target_entity_id: "claim-1" });
  });

  it("drop a value already known and never reach the store with a short quote", async () => {
    writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "current-city", outcome: "already_recorded", claimId: "c" }] });
    const { applyLexiconFact } = load();
    expect((await applyLexiconFact({}, "fixture-user", suggestion())).status).toBe("removed");
    writeFact.mockReset();
    expect((await applyLexiconFact({}, "fixture-user", suggestion({ evidence_quote: "Lisbon" }))).status).toBe("pending_review");
    expect(writeFact).not.toHaveBeenCalled();
  });
});

// Review 2026-09-29: enrichment sent every note, moment, page and scan about a
// person to a model, for people hidden from AI and marked sensitive too.
describe("who may be enriched", () => {
  const { enrichmentRefusal } = load();
  const person = (over: Record<string, unknown> = {}) => ({ merged_into: null, ai_visibility: "visible", is_sensitive: false, ...over });

  it("a visible person may be", () => {
    expect(enrichmentRefusal(person(), true)).toBeNull();
  });

  it("a person hidden from AI, or merged away, is not", () => {
    expect(enrichmentRefusal(person({ ai_visibility: "hidden" }), false)).toBe("hidden_from_ai");
    expect(enrichmentRefusal(person({ merged_into: "someone" }), false)).toBe("contact_not_found");
  });

  it("a sensitive person is not, while the owner hides sensitive people from AI", () => {
    expect(enrichmentRefusal(person({ is_sensitive: true }), true)).toBe("sensitive_person");
    expect(enrichmentRefusal(person({ is_sensitive: true }), false)).toBeNull();
  });
});
