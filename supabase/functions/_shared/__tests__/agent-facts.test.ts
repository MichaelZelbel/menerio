// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  embeddingCandidates,
  factLine,
  groupFactsBySection,
  readFacts,
  renderFactSections,
  type FactRow,
} from "../agent-facts";
import {
  addClaim,
  contactContextLines,
  contactHighlights,
  contactProfileText,
  entityFacts,
  getClaims,
  resolveEntityByName,
  userProfileFacts,
} from "../../menerio-mcp/fact-tools";
import { getUserProfile } from "../user-profile";
import { loadPersonProfile } from "../read-tools";
import { factsForPage, loadPeopleData } from "../people-sync-core";
import { factDb, queriesWithoutUser, type FixtureFact, type Row } from "./fact-db";

/**
 * The fact readers after go-live (docs/plans/one-fact-store.md 2.3, 3.3):
 * everything that leaves the owner's view reads agent_facts, so a private
 * section, a hidden or sensitive person and a hidden or sensitive entity never
 * print; each fact prints once; and every service-role query names its user.
 *
 * The values of the facts that must never print all contain "SECRET", so one
 * substring check covers every way a value could leak.
 */
const ME = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const ANNA = "00000000-0000-4000-8000-0000000000a1";
const HIDDEN = "00000000-0000-4000-8000-0000000000a2";
const SENSITIVE = "00000000-0000-4000-8000-0000000000a3";
const ACME = "00000000-0000-4000-8000-0000000000e1";
const SECRET_ENTITY = "00000000-0000-4000-8000-0000000000e2";
const HIDDEN_ENTITY = "00000000-0000-4000-8000-0000000000e3";

const contacts: Row[] = [
  { id: ANNA, user_id: ME, name: "Anna Berg", aliases: [], ai_visibility: "visible", is_sensitive: false },
  { id: HIDDEN, user_id: ME, name: "Hidden Person", aliases: [], ai_visibility: "hidden", is_sensitive: false },
  { id: SENSITIVE, user_id: ME, name: "Sensitive Person", aliases: [], ai_visibility: "visible", is_sensitive: true },
];
const entities: Row[] = [
  { id: ACME, user_id: ME, name: "Acme", aliases: ["ACME Corp"], ai_visibility: "visible", is_sensitive: false },
  { id: SECRET_ENTITY, user_id: ME, name: "Acme Clinic", aliases: [], ai_visibility: "visible", is_sensitive: true },
  { id: HIDDEN_ENTITY, user_id: ME, name: "Hidden Thing", aliases: [], ai_visibility: "hidden", is_sensitive: false },
];

function fixture(): FixtureFact[] {
  return [
    // self
    { claim_id: "s1", user_id: ME, subject_type: "self", subject_id: null, attribute: "current-city", label: "Current city", value: "Berlin", category_slug: "location", show_to_agent: true, is_pinned: true },
    { claim_id: "s2", user_id: ME, subject_type: "self", subject_id: null, attribute: "current-city", label: "Current city", value: "Hamburg", category_slug: "location", valid_to: "2025-01-01" },
    { claim_id: "s3", user_id: ME, subject_type: "self", subject_id: null, attribute: "diagnosis", label: "Diagnosis", value: "SECRET-self-private", category_slug: "health", visibility_scope: "private" },
    { claim_id: "s4", user_id: ME, subject_type: "self", subject_id: null, attribute: "employer", label: "Employer", value: "Ownward", category_slug: "professional", visibility_scope: "professional", source_type: "note", source_id: "n1" },
    // Anna: a visible contact
    { claim_id: "a1", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "birthday", label: "Birthday", value: "1990-04-02", category_slug: "identity", category_name: "Identity & Basics", show_to_agent: true },
    { claim_id: "a2", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "employer", label: "Employer", value: "Acme", category_slug: "professional", has_conflict: true },
    { claim_id: "a3", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "employer", label: "Employer", value: "Globex", category_slug: "professional", has_conflict: true },
    { claim_id: "a4", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "employer", label: "Employer", value: "Initech", category_slug: "professional", valid_from: "2019-01-01", valid_to: "2021-06-30" },
    { claim_id: "a5", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "therapy", label: "Therapy", value: "SECRET-anna-private", category_slug: "health", visibility_scope: "private" },
    { claim_id: "a6", user_id: ME, subject_type: "contact", subject_id: ANNA, attribute: "favourite-food", label: "Favourite food", value: "Ramen" },
    // hidden and sensitive people
    { claim_id: "h1", user_id: ME, subject_type: "contact", subject_id: HIDDEN, attribute: "birthday", label: "Birthday", value: "SECRET-hidden-birthday", category_slug: "identity" },
    { claim_id: "x1", user_id: ME, subject_type: "contact", subject_id: SENSITIVE, attribute: "birthday", label: "Birthday", value: "SECRET-sensitive-birthday", category_slug: "identity", show_to_agent: true },
    // entities
    { claim_id: "e1", user_id: ME, subject_type: "entity", subject_id: ACME, attribute: "headquarters", value: "Munich" },
    { claim_id: "e2", user_id: ME, subject_type: "entity", subject_id: ACME, attribute: "headquarters", value: "Bonn", valid_from: "2010-01-01", valid_to: "2015-01-01" },
    { claim_id: "e3", user_id: ME, subject_type: "entity", subject_id: SECRET_ENTITY, attribute: "patient", value: "SECRET-sensitive-entity" },
    { claim_id: "e4", user_id: ME, subject_type: "entity", subject_id: HIDDEN_ENTITY, attribute: "owner", value: "SECRET-hidden-entity" },
    // another user's facts
    { claim_id: "o1", user_id: OTHER_USER, subject_type: "self", subject_id: null, attribute: "current-city", value: "SECRET-other-user" },
    { claim_id: "o2", user_id: OTHER_USER, subject_type: "contact", subject_id: ANNA, attribute: "birthday", value: "SECRET-other-user-anna" },
  ];
}

function db(extra: Record<string, Row[]> = {}) {
  return factDb({
    facts: fixture(),
    tables: { contacts: contacts.map((c) => ({ ...c })), entities: entities.map((e) => ({ ...e })), ...extra },
  });
}

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
function expectNoSecret(v: unknown) {
  expect(text(v)).not.toContain("SECRET");
}
function expectEveryQueryNamesItsUser(d: ReturnType<typeof db>) {
  expect(queriesWithoutUser(d)).toEqual([]);
  expect(d.log.length).toBeGreaterThan(0);
}
function countOf(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

describe("readFacts", () => {
  it("reads agent_facts, current rows only, for this user only", async () => {
    const d = db();
    const rows = await readFacts(d, ME);
    expect(new Set(d.log.map((q) => q.table))).toEqual(new Set(["agent_facts"]));
    expect(rows.every((r) => r.user_id === ME && r.is_current)).toBe(true);
    expect(rows.map((r) => r.claim_id).sort()).toEqual(["a1", "a2", "a3", "a6", "e1", "s1", "s4"]);
    expectNoSecret(rows);
    expectEveryQueryNamesItsUser(d);
  });

  it("adds history only when asked", async () => {
    const d = db();
    const rows = await readFacts(d, ME, { subjectType: "contact", subjectIds: [ANNA], history: true });
    expect(rows.map((r) => r.claim_id).sort()).toEqual(["a1", "a2", "a3", "a4", "a6"]);
  });

  it("reads nothing for an empty id list", async () => {
    const d = db();
    expect(await readFacts(d, ME, { subjectIds: [] })).toEqual([]);
    expect(d.log).toEqual([]);
  });

  it("refuses to run without a user", async () => {
    await expect(readFacts(db(), "")).rejects.toThrow(/no user/);
  });
});

describe("printing facts", () => {
  const row = (over: Partial<FactRow>): FactRow => ({
    claim_id: "c", user_id: ME, subject_type: "contact", subject_id: ANNA, contact_id: ANNA, attribute: "employer",
    value: "Acme", valid_from: null, valid_to: null, is_current: true, confidence: "likely", cardinality: "one",
    origin: "ai_note", rank: "normal", evidence_quote: null, source_type: "ai", source_id: null, review_by: null,
    created_at: null, updated_at: null, slot_id: null, label: "Employer", category_slug: "professional",
    category_name: null, visibility_scope: "all", is_pinned: false, show_to_agent: false, has_conflict: false, ...over,
  });

  it("prints each fact once even when a caller hands it in twice", () => {
    const a = row({ claim_id: "1", value: "Acme" });
    const lines = renderFactSections([a, { ...a }, row({ claim_id: "2", attribute: "birthday", label: "Birthday", value: "1990", category_slug: "identity" })]);
    expect(countOf(lines.join("\n"), "Acme")).toBe(1);
    expect(lines[0]).toBe("## Identity & Basics");
  });

  it("files a fact without a section under Other, last", () => {
    const sections = groupFactsBySection([row({ claim_id: "1", category_slug: null }), row({ claim_id: "2", category_slug: "food" })]);
    expect(sections.map((s) => s.name)).toEqual(["Food & Drink", "Other"]);
  });

  it("flags two answers and says when a fact ended", () => {
    expect(factLine(row({ has_conflict: true }))).toContain("TWO ANSWERS");
    expect(factLine(row({ is_current: false, valid_to: "2021-01-01" }), "2026-09-28")).toContain("no longer true");
    expect(factLine(row({ review_by: "2026-01-01" }), "2026-09-28")).toContain("not confirmed since 2026-01-01");
  });

  it("says how many it left out when capped", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ claim_id: String(i), value: `v${i}`, label: `L${i}` }));
    const lines = renderFactSections(rows, { max: 2 });
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(2);
    expect(lines.at(-1)).toBe("(3 more fact(s) not shown)");
  });
});

describe("get_claims", () => {
  it("current: what is true now, nothing private, hidden or sensitive", async () => {
    const d = db();
    const out = await getClaims(d, ME, { mode: "current", limit: 100 });
    const ids = (out.claims as Row[]).map((c) => c.id).sort();
    expect(ids).toEqual(["a1", "a2", "a3", "a6", "e1", "s1", "s4"]);
    expectNoSecret(out);
    expectEveryQueryNamesItsUser(d);
    expect(d.log.every((q) => q.table === "agent_facts")).toBe(true);
  });

  it("history: ended facts too, still nothing private, hidden or sensitive", async () => {
    const d = db();
    const out = await getClaims(d, ME, { mode: "history", limit: 100 });
    const ids = (out.claims as Row[]).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["a4", "e2", "s2"]));
    expectNoSecret(out);
    expectEveryQueryNamesItsUser(d);
  });

  it("changed_since: facts that started or ended on or after the day", async () => {
    const d = db();
    const out = await getClaims(d, ME, { mode: "changed_since", since: "2021-01-01", limit: 100 });
    expect((out.claims as Row[]).map((c) => c.id).sort()).toEqual(["a4", "s2"]);
    expect(await getClaims(d, ME, { mode: "changed_since", limit: 100 })).toHaveProperty("error");
    expectEveryQueryNamesItsUser(d);
  });

  it("a subject filter on a sensitive person returns nothing, not their facts", async () => {
    for (const mode of ["current", "history"] as const) {
      const out = await getClaims(db(), ME, { mode, subjectType: "contact", subjectId: SENSITIVE, limit: 100 });
      expect(out.count).toBe(0);
    }
    const hiddenEntity = await getClaims(db(), ME, { mode: "history", subjectType: "entity", subjectId: HIDDEN_ENTITY, limit: 100 });
    expect(hiddenEntity.count).toBe(0);
  });

  it("self: only the user's own facts, and it flags two answers", async () => {
    const self = await getClaims(db(), ME, { mode: "current", subjectType: "self", limit: 100 });
    expect((self.claims as Row[]).every((c) => c.subject_type === "self")).toBe(true);
    const anna = await getClaims(db(), ME, { mode: "current", subjectType: "contact", subjectId: ANNA, attribute: "employer", limit: 100 });
    expect((anna.claims as Row[]).map((c) => c.two_answers)).toEqual([true, true]);
  });
});

describe("get_entity_context facts", () => {
  it("current by default, history on request", async () => {
    const d = db();
    const plain = await entityFacts(d, ME, ACME, false);
    expect(plain.facts.map((f) => f.value)).toEqual(["Munich"]);
    expect(plain.history).toBeUndefined();
    const full = await entityFacts(d, ME, ACME, true);
    expect(full.history!.map((f) => f.value)).toEqual(["Bonn"]);
    expectEveryQueryNamesItsUser(d);
  });

  it("a sensitive or hidden entity has no facts here, in either mode", async () => {
    for (const id of [SECRET_ENTITY, HIDDEN_ENTITY]) {
      for (const history of [false, true]) {
        const out = await entityFacts(db(), ME, id, history);
        expectNoSecret(out);
        expect(out.facts).toEqual([]);
      }
    }
  });
});

describe("get_contact_profile", () => {
  it("curated: the flagged facts; full: every current fact, each once, by section", async () => {
    const d = db();
    const curated = await contactProfileText(d, ME, { contact: { id: ANNA, name: "Anna Berg" }, detail: "curated", includeHistory: false });
    expect(curated).toContain("1990-04-02");
    expect(curated).not.toContain("Ramen");
    expect(curated).toContain("Curated view");

    const full = await contactProfileText(d, ME, { contact: { id: ANNA, name: "Anna Berg" }, detail: "full", includeHistory: false });
    for (const v of ["1990-04-02", "Acme", "Globex", "Ramen"]) expect(countOf(full, v)).toBe(1);
    expect(full).toContain("## Identity & Basics");
    expect(full).toContain("## Professional Life");
    expect(full).toContain("TWO ANSWERS");
    expect(full).not.toContain("Initech");
    expectNoSecret(full);
    expectEveryQueryNamesItsUser(d);
  });

  it("history on request", async () => {
    const out = await contactProfileText(db(), ME, { contact: { id: ANNA, name: "Anna Berg" }, detail: "full", includeHistory: true, today: "2026-09-28" });
    expect(out).toContain("## History");
    expect(out).toContain("Initech (2019-01-01 to 2021-06-30) [no longer true]");
    expectNoSecret(out);
  });

  it("falls back to the whole record, and says so, when nothing is flagged", async () => {
    const d = db();
    for (const f of d.tables.claims) if (f.id === "a1") f.id = "a1-gone"; // drop the only flagged fact
    const out = await contactProfileText(d, ME, { contact: { id: ANNA, name: "Anna Berg" }, detail: "curated", includeHistory: false });
    expect(out).toContain("Ramen");
    expect(out).toContain("No fact on Anna Berg is flagged");
  });

  it("does not stop early for a person whose only section is private", async () => {
    const d = db();
    d.tables.claims = d.tables.claims.filter((c) => c.subject_id !== ANNA || c.id === "a5");
    const out = await contactProfileText(d, ME, { contact: { id: ANNA, name: "Anna Berg" }, detail: "full", includeHistory: false, topicsSection: "Open topics: none" });
    expect(out).toContain("Open topics: none");
    expect(out).toContain("No facts recorded yet.");
    expectNoSecret(out);
  });

  it("a hidden or sensitive person's facts never print", async () => {
    for (const id of [HIDDEN, SENSITIVE]) {
      const out = await contactProfileText(db(), ME, { contact: { id, name: "X" }, detail: "full", includeHistory: true });
      expectNoSecret(out);
    }
  });
});

describe("get_contact_context and search_contacts", () => {
  it("prints current facts by section, capped", async () => {
    const d = db();
    const lines = await contactContextLines(d, ME, ANNA, 2);
    expect(lines.slice(0, 2)).toEqual(["", "## Profile"]);
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/more fact\(s\) not shown/);
    expectNoSecret(lines);
    expectEveryQueryNamesItsUser(d);
  });

  it("highlights come from visible people only", async () => {
    const d = db();
    const map = await contactHighlights(d, ME, [ANNA, HIDDEN, SENSITIVE]);
    expect(map.get(ANNA)).toEqual(expect.arrayContaining(["Birthday: 1990-04-02"]));
    expect(map.has(HIDDEN)).toBe(false);
    expect(map.has(SENSITIVE)).toBe(false);
    expectEveryQueryNamesItsUser(d);
  });
});

describe("get_user_profile and the chats' user digest", () => {
  it("the user's own current facts, never private, never a contact's", async () => {
    const d = db();
    const full = await userProfileFacts(d, ME, { detail: "full" });
    const all = text(full);
    expect(all).toContain("Berlin");
    expect(all).not.toContain("Hamburg");
    expect(all).not.toContain("Ramen");
    expectNoSecret(full);
    expect(full.noteIds).toEqual(["n1"]);
    const curated = await userProfileFacts(d, ME, { detail: "curated" });
    expect(curated.curationApplied).toBe(true);
    expect(text(curated)).not.toContain("Ownward");
    const personal = await userProfileFacts(d, ME, { detail: "full", scope: "personal" });
    expect(text(personal)).not.toContain("Ownward");
    expectEveryQueryNamesItsUser(d);
  });

  it("getUserProfile: agent_facts for self, current rows only", async () => {
    const d = db({ agent_instructions: [{ user_id: ME, instruction: "Be brief.", applies_to: "all", is_active: true, sort_order: 1 }] });
    const profile = await getUserProfile(d, ME);
    const all = text(profile);
    expect(all).toContain("Berlin");
    expect(countOf(all, "Berlin")).toBe(1);
    expect(all).not.toContain("Hamburg");
    expect(all).not.toContain("Anna");
    expectNoSecret(profile);
    expect(profile.agent_instructions).toEqual(["Be brief."]);
    expectEveryQueryNamesItsUser(d);
  });
});

describe("the chats' person profile", () => {
  const rels = [
    { id: "r1", user_id: ME, source_type: "contact", source_id: ANNA, target_type: "contact", target_id: HIDDEN, label: "SECRET-rel-hidden" },
    { id: "r2", user_id: ME, source_type: "contact", source_id: SENSITIVE, target_type: "contact", target_id: ANNA, label: "SECRET-rel-sensitive" },
    { id: "r3", user_id: ME, source_type: "self", source_id: null, target_type: "contact", target_id: ANNA, label: "friend" },
  ];

  it("current facts from agent_facts; relationships to hidden or sensitive people are left out", async () => {
    const d = db({ contact_relationships: rels });
    const p = await loadPersonProfile(d, ME, ANNA);
    expect(p).not.toBeNull();
    expect(p!.facts.map((f) => f.value)).toEqual(expect.arrayContaining(["1990-04-02", "Ramen"]));
    expect(p!.facts.map((f) => f.value)).not.toContain("Initech");
    expect(p!.relationships).toEqual([{ from: "the user", label: "friend", to: "Anna Berg" }]);
    expectNoSecret(p);
    expectEveryQueryNamesItsUser(d);
  });

  it("nothing at all for a hidden or sensitive person", async () => {
    expect(await loadPersonProfile(db(), ME, HIDDEN)).toBeNull();
    expect(await loadPersonProfile(db(), ME, SENSITIVE)).toBeNull();
  });
});

describe("the people vault", () => {
  it("reads profile_facts current rows (private included, it is the owner's own export), pinned first", async () => {
    const d = db({ contact_groups: [], contact_group_memberships: [], github_sync_log: [], fact_slots: [], profile_categories: [] });
    const data = await loadPeopleData(d, ME);
    expect(d.log.some((q) => q.table === "profile_facts")).toBe(true);
    expect(d.log.some((q) => q.table === "agent_facts")).toBe(false);
    const values = data.facts.map((f) => f.value);
    expect(values).toEqual(expect.arrayContaining(["SECRET-anna-private", "SECRET-hidden-birthday"]));
    expect(values).not.toContain("Initech");
    expect(values).not.toContain("SECRET-other-user-anna");
    expect(queriesWithoutUser(d)).toEqual([]);

    const factsByContact = new Map([[ANNA, data.facts.filter((f) => f.subject_id === ANNA)]]);
    const page = factsForPage(ANNA, { factsByContact, categoriesByContact: new Map([[ANNA, [{ id: "cat-1", slug: "identity", name: "Identity", sort_order: 0 }]]]) });
    expect(page.entries[0]).toMatchObject({ category_id: "cat-1", value: "1990-04-02" });
    expect(page.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Identity", "Professional Life", "Health & Wellness", "Other"]));
  });
});

describe("embedding candidates", () => {
  it("only claims an assistant may see, and only those without an embedding", async () => {
    const d = db();
    d.tables.claims.find((c) => c.id === "a6")!.embedding = [0.1];
    const { candidates, total } = await embeddingCandidates(d, ME, 100);
    const ids = candidates.map((c) => c.claim_id).sort();
    expect(ids).toEqual(["a1", "a2", "a3", "a4", "e1", "e2", "s1", "s2", "s4"]);
    expect(total).toBe(9);
    expectNoSecret(candidates);
    expectEveryQueryNamesItsUser(d);
    expect((await embeddingCandidates(d, ME, 2)).candidates).toHaveLength(2);
  });
});

describe("add_claim", () => {
  const base = { subject: { type: "contact" as const, id: ANNA }, attribute: "Favourite drink", value: "Mate", evidenceQuote: "Anna said she drinks Mate every morning." };

  it("refuses a fact without a quote, and writes nothing", async () => {
    const d = db();
    const before = d.tables.claims.length;
    for (const evidenceQuote of [undefined, null, "", "too short"]) {
      const out = await addClaim(d, ME, { ...base, evidenceQuote });
      expect(out.error).toMatch(/evidence_quote is required/);
    }
    expect(d.tables.claims.length).toBe(before);
    expect(d.log.filter((q) => q.action !== "select")).toEqual([]);
  });

  it("records a new fact as origin mcp, and the same value again is a no-op", async () => {
    const d = db();
    const before = d.tables.claims.length;
    const first = await addClaim(d, ME, base);
    expect(first).toMatchObject({ tool: "add_claim", recorded: 1 });
    expect(d.tables.claims.length).toBe(before + 1);
    const row = d.tables.claims.at(-1)!;
    expect(row).toMatchObject({ user_id: ME, subject_type: "contact", subject_id: ANNA, value: "Mate", origin: "mcp", source_type: "ai" });

    const again = await addClaim(d, ME, { ...base, value: " mate " });
    expect(again).toMatchObject({ recorded: 0, unchanged: 1 });
    expect(d.tables.claims.length).toBe(before + 1);
    expect(d.tables.claims.filter((c) => c.embedding !== null && c.embedding !== undefined)).toEqual([]);
    expectEveryQueryNamesItsUser(d);
  });

  it("refuses a relationship, a fact that already ended, and another user's person", async () => {
    const d = db();
    expect((await addClaim(d, ME, { ...base, attribute: "relationship" })).error).toMatch(/not claims/);
    expect((await addClaim(d, ME, { ...base, validTo: "2020-01-01" })).error).toMatch(/already ended/);
    expect((await addClaim(d, OTHER_USER, base)).error).toMatch(/contact_not_found/);
  });

  it("says the store is paused instead of writing", async () => {
    const d = db();
    d.paused = true;
    expect((await addClaim(d, ME, base)).error).toMatch(/try again/);
  });

  it("an ambiguous entity name is refused with the candidates", async () => {
    const d = db();
    const out = await resolveEntityByName(d, ME, "acm");
    expect("error" in out && out.error).toMatch(/more than one entity/);
    const exact = await resolveEntityByName(d, ME, "acme corp");
    expect(exact).toEqual({ entity: { id: ACME, name: "Acme" } });
    expectEveryQueryNamesItsUser(d);
  });
});
