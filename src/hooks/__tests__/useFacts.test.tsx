import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createFakeSupabase, filterValue } from "@/test/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));
const rows = vi.hoisted(() => ({ facts: [] as any[], timezone: null as string | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { createFakeSupabase } = await import("@/test/fake-supabase");
  fake.current = createFakeSupabase((q) => {
    if (q.table === "profile_facts" && q.op === "select") return { data: rows.facts };
    if (q.table === "profiles" && q.op === "select") return { data: rows.timezone === null ? null : { timezone: rows.timezone } };
    if (q.table === "claims" && q.op === "delete") return { data: [{ id: "c1" }] };
    return undefined;
  });
  return { supabase: fake.current.client };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({ triggerPeopleSync: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import {
  describeClaimWriteError,
  describeFactRefusal,
  DuplicateFactValueError,
  groupFacts,
  groupSlots,
  invokeWriteFact,
  OTHER_SECTION,
  PAUSED_MESSAGE,
  todayInTimeZone,
  useFacts,
  type ProfileFact,
} from "../useFacts";
import { showToast } from "@/lib/toast";
import { toast } from "sonner";

const fact = (over: Partial<ProfileFact> = {}): ProfileFact => ({
  claim_id: "c1",
  user_id: "user-1",
  subject_type: "contact",
  subject_id: "p1",
  contact_id: "p1",
  attribute: "languages",
  value: "German",
  valid_from: null,
  valid_to: null,
  is_current: true,
  confidence: "certain",
  cardinality: "many",
  origin: "user_manual",
  rank: "preferred",
  evidence_quote: null,
  source_type: "manual",
  source_id: null,
  review_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  slot_id: "s1",
  label: "Languages",
  category_slug: "identity",
  category_name: null,
  visibility_scope: "all",
  is_pinned: false,
  show_to_agent: false,
  has_conflict: false,
  ...over,
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => {
  fake.current!.reset();
  rows.facts = [];
  rows.timezone = null;
  fake.current!.setInvokeResult(async () => ({
    data: { ok: true, facts: [{ attribute: "languages", outcome: "inserted", claimId: "new", closed: 0 }] },
    error: null,
  }));
  vi.clearAllMocks();
});

describe("groupSlots / groupFacts", () => {
  it("shows several current values of one slot as one line, and closed ones as its history", () => {
    const slots = groupSlots([
      fact({ claim_id: "a", value: "German", created_at: "2026-01-01T00:00:00Z" }),
      fact({ claim_id: "b", value: "English", created_at: "2026-02-01T00:00:00Z" }),
      fact({ claim_id: "c", value: "French", is_current: false, valid_to: "2025-12-01" }),
    ]);
    expect(slots).toHaveLength(1);
    expect(slots[0].current.map((f) => f.value)).toEqual(["German", "English"]);
    expect(slots[0].history.map((f) => f.value)).toEqual(["French"]);
  });

  it("flags two answers only from current rows", () => {
    const [slot] = groupSlots([
      fact({ claim_id: "a", attribute: "city", slot_id: "s2", label: "City", value: "Berlin", has_conflict: true }),
      fact({ claim_id: "b", attribute: "city", slot_id: "s2", label: "City", value: "London", has_conflict: true }),
    ]);
    expect(slot.hasConflict).toBe(true);
  });

  it("groups a claim without a slot row by its attribute", () => {
    const slots = groupSlots([
      fact({ claim_id: "a", slot_id: null, attribute: "pets" }),
      fact({ claim_id: "b", slot_id: null, attribute: "pets", value: "Cat" }),
    ]);
    expect(slots.map((s) => s.key)).toEqual(["attr:pets"]);
  });

  it("orders sections by the taxonomy, custom sections after, Other last", () => {
    const sections = groupFacts(
      [
        fact({ claim_id: "1", slot_id: "a", category_slug: null, attribute: "x", label: "X" }),
        fact({ claim_id: "2", slot_id: "b", category_slug: "food", attribute: "y", label: "Y" }),
        fact({ claim_id: "3", slot_id: "c", category_slug: "identity", attribute: "z", label: "Z" }),
        fact({ claim_id: "4", slot_id: "d", category_slug: "my-stuff", attribute: "w", label: "W" }),
      ],
      [],
    );
    expect(sections.map((s) => s.key)).toEqual(["identity", "food", "my-stuff", OTHER_SECTION]);
    expect(sections[0].name).toBe("Identity & Basics");
    expect(sections[3].name).toBe("Other");
  });

  it("uses the subject's own section row for name and scope, and keeps an empty custom section", () => {
    const cat = (slug: string, name: string, scope = "all") => ({
      id: `cat-${slug}`, user_id: "user-1", name, slug, icon: "folder", description: null, sort_order: 0,
      is_default: false, visibility_scope: scope, created_at: "", updated_at: "",
    });
    const sections = groupFacts([fact({ category_slug: "health" })], [
      cat("health", "Gesundheit", "private"),
      cat("empty-custom", "Empty"),
      cat("food", "Food & Drink"), // an empty taxonomy section stays hidden
    ]);
    expect(sections.map((s) => [s.key, s.name, s.visibilityScope])).toEqual([
      ["health", "Gesundheit", "private"],
      ["empty-custom", "Empty", "all"],
    ]);
  });
});

describe("invokeWriteFact", () => {
  it("tells the user the app is updating when writes are paused (503)", async () => {
    fake.current!.setInvokeResult(async () => ({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: { status: 503, json: async () => ({ ok: false, error: "paused" }) },
      }),
    }));
    await expect(invokeWriteFact({ label: "City", value: "Berlin" })).rejects.toThrow(PAUSED_MESSAGE);
  });

  it("turns a 409 refusal into its reason", async () => {
    fake.current!.setInvokeResult(async () => ({
      data: null,
      error: Object.assign(new Error("non-2xx"), {
        context: {
          status: 409,
          json: async () => ({ ok: false, facts: [{ attribute: "relationship", outcome: "rejected", reason: "relationships_are_links" }] }),
        },
      }),
    }));
    await expect(invokeWriteFact({ label: "Relationship", value: "Wife" })).rejects.toThrow(
      describeFactRefusal("relationships_are_links"),
    );
  });

  it("sends write_fact with the subject and never an origin (the server sets user_manual)", async () => {
    await invokeWriteFact({ contact_id: "p1", label: "City", value: "Berlin", category_slug: "location" });
    expect(fake.current!.invocations).toEqual([
      {
        name: "normalize-profile",
        body: { action: "write_fact", contact_id: "p1", label: "City", value: "Berlin", category_slug: "location" },
      },
    ]);
  });
});

describe("useFacts", () => {
  it("reads profile_facts for one contact, and nothing else", async () => {
    rows.facts = [fact()];
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.facts).toHaveLength(1));
    const [read] = fake.current!.on("profile_facts", "select");
    expect(filterValue(read, "eq", "subject_type")).toBe("contact");
    expect(filterValue(read, "eq", "subject_id")).toBe("p1");
    // Reads only: the facts, and the profile's time zone ("today" for dates).
    expect(new Set(fake.current!.queries.map((q) => q.table))).toEqual(new Set(["profile_facts", "profiles"]));
    expect(fake.current!.queries.every((q) => q.op === "select")).toBe(true);
    expect(fake.current!.invocations).toEqual([]); // no adoption or backfill on open
  });

  it("reads self facts with subject_id IS NULL", async () => {
    renderHook(() => useFacts({ type: "self" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(fake.current!.on("profile_facts", "select")).toHaveLength(1));
    const [read] = fake.current!.on("profile_facts", "select");
    expect(filterValue(read, "eq", "subject_type")).toBe("self");
    expect(read.filters).toContainEqual(["is", "subject_id", null]);
  });

  it("adds through write_fact and refreshes every fact view", async () => {
    const qc = newClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(qc) });
    await result.current.addFact.mutateAsync({ label: "Languages", value: "English", category_slug: "identity" });
    expect(fake.current!.invocations[0].body).toMatchObject({
      action: "write_fact",
      contact_id: "p1",
      label: "Languages",
      value: "English",
      category_slug: "identity",
    });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const key of ["profile-facts", "profile-summary", "claims", "world-claims"]) {
      expect(keys).toContain(JSON.stringify([key]));
    }
  });

  it("It changed: writes the new value from a date and ends the old one", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const old = fact({ claim_id: "old", attribute: "current-city", value: "Berlin", label: "Current city" });
    await result.current.changeFact.mutateAsync({ fact: old, value: "London", validFrom: "2026-09-01" });
    expect(fake.current!.invocations[0].body).toMatchObject({
      action: "write_fact",
      contact_id: "p1",
      // The slot's own key goes along, so an old key is never re-derived from the label.
      label: "Current city",
      attribute: "current-city",
      value: "London",
      valid_from: "2026-09-01",
    });
    const [end] = fake.current!.on("claims", "update");
    expect(end.payload).toEqual({ valid_to: "2026-09-01" });
    expect(filterValue(end, "eq", "id")).toBe("old");
    // Still open, or set to end later than the new day (a change dated in the future).
    expect(end.filters).toContainEqual(["or", "valid_to.is.null,valid_to.gt.2026-09-01", undefined]);
  });

  it("It changed twice on one day: the value that started today is ended too (eleventh review)", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const today = fact({ claim_id: "fr", value: "French", valid_from: "2026-09-29" });
    await result.current.changeFact.mutateAsync({ fact: today, value: "Spanish", validFrom: "2026-09-29" });
    const [end] = fake.current!.on("claims", "update");
    expect(end?.payload).toEqual({ valid_to: "2026-09-29" });
    expect(filterValue(end, "eq", "id")).toBe("fr");
  });

  it("Fix a mistake on a machine's value corrects it and suppresses the old words", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await result.current.fixFact.mutateAsync({ fact: fact({ origin: "ai_note", value: "Germn" }), value: "German" });
    const [update] = fake.current!.on("claims", "update");
    expect(update.payload).toEqual({ value: "German" });
    const [suppression] = fake.current!.on("ai_suggestion_suppressions", "upsert");
    expect(suppression.payload).toMatchObject({
      suggestion_type: "claim",
      target_entity_type: "claim",
      target_entity_id: "c1",
      normalized_value: "germn",
      suppression_key: "contact:p1:languages:germn",
    });
  });

  it("Fix a mistake on the user's own value writes no suppression", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await result.current.fixFact.mutateAsync({ fact: fact({ value: "Germn" }), value: "German" });
    expect(fake.current!.on("ai_suggestion_suppressions")).toHaveLength(0);
  });

  it("No longer true sets valid_to and keeps the row", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await result.current.endFact.mutateAsync({ fact: fact(), date: "2026-09-28" });
    const [end] = fake.current!.on("claims", "update");
    expect(end.payload).toEqual({ valid_to: "2026-09-28" });
    expect(fake.current!.on("claims", "delete")).toHaveLength(0);
  });

  it("Was wrong deletes the claim and remembers the value", async () => {
    const { result } = renderHook(() => useFacts({ type: "self" }), { wrapper: wrapper(newClient()) });
    await result.current.retract.mutateAsync(
      fact({ subject_type: "self", subject_id: null, contact_id: null, value: " Klingon " }),
    );
    const [suppression] = fake.current!.on("ai_suggestion_suppressions", "upsert");
    expect(suppression.payload).toMatchObject({ suppression_key: "self::languages:klingon", normalized_value: "klingon" });
    expect(suppression.options).toEqual({ onConflict: "user_id,suppression_key" });
    const [del] = fake.current!.on("claims", "delete");
    expect(filterValue(del, "eq", "id")).toBe("c1");
  });

  it("Both are true sets the slot to many; pin and label are slot updates", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const [slot] = groupSlots([fact()]);
    await result.current.updateSlot.mutateAsync({ slot, patch: { cardinality: "many" } });
    await result.current.updateSlot.mutateAsync({ slot, patch: { is_pinned: true, label: " Spoken languages " } });
    const updates = fake.current!.on("fact_slots", "update");
    expect(updates.map((u) => u.payload)).toEqual([{ cardinality: "many" }, { is_pinned: true, label: "Spoken languages" }]);
    expect(filterValue(updates[0], "eq", "id")).toBe("s1");
  });

  it("re-filing a claim without a slot row creates the slot", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const [slot] = groupSlots([fact({ slot_id: null, category_slug: null, label: "Pets", attribute: "pets" })]);
    await result.current.updateSlot.mutateAsync({ slot, patch: { category_slug: "hobbies" } });
    const [insert] = fake.current!.on("fact_slots", "insert");
    expect(insert.payload).toEqual({
      user_id: "user-1",
      subject_type: "contact",
      subject_id: "p1",
      attribute: "pets",
      label: "Pets",
      category_slug: "hobbies",
    });
  });

  it("Keep this one ends the other current values today", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const [slot] = groupSlots([
      fact({ claim_id: "a", value: "Berlin", has_conflict: true }),
      fact({ claim_id: "b", value: "London", has_conflict: true }),
      fact({ claim_id: "c", value: "Paris", has_conflict: true }),
    ]);
    await result.current.keepOnly.mutateAsync({ slot, keep: slot.current[1] });
    const [end] = fake.current!.on("claims", "update");
    expect(filterValue(end, "in", "id")).toEqual(["a", "c"]);
    expect(Object.keys(end.payload as object)).toEqual(["valid_to"]);
  });

  it("reports a refused add instead of claiming success", async () => {
    fake.current!.setInvokeResult(async () => ({ data: { ok: false, facts: [{ outcome: "rejected", reason: "bad_date" }] }, error: null }));
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await expect(result.current.addFact.mutateAsync({ label: "Birthday", value: "x" })).rejects.toThrow("That date is not valid.");
    expect(showToast.error).toHaveBeenCalledWith("That date is not valid.");
    expect(showToast.success).not.toHaveBeenCalled();
  });
  it("Fix a mistake into a value that is already live says so in words and writes nothing", async () => {
    rows.facts = [
      fact({ claim_id: "en", value: "English" }),
      fact({ claim_id: "typo", value: "Englsh", created_at: "2026-02-01T00:00:00Z" }),
    ];
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.facts).toHaveLength(2));
    await expect(
      result.current.fixFact.mutateAsync({ fact: rows.facts[1], value: "english" }),
    ).rejects.toBeInstanceOf(DuplicateFactValueError);
    expect(fake.current!.on("claims", "update")).toHaveLength(0);
    expect(showToast.error).not.toHaveBeenCalled();
    const [message, options] = vi.mocked(toast.info).mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('"english" is already recorded under Languages, so this entry was not changed.');
    expect(message).not.toMatch(/claims_one_live_value|duplicate key/);
    // One click removes the mistaken entry ("Was wrong").
    expect(options.action.label).toBe("Remove this entry");
    options.action.onClick();
    await waitFor(() => expect(fake.current!.on("claims", "delete")).toHaveLength(1));
    expect(filterValue(fake.current!.on("claims", "delete")[0], "eq", "id")).toBe("typo");
  });

  it("Fix a mistake: the database's unique-index refusal (a stale page) reads the same", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    const client = fake.current!.client as { from: (table: string) => any };
    const original = client.from;
    client.from = (table: string) => {
      const chain = original(table);
      if (table !== "claims") return chain;
      const update = chain.update;
      chain.update = (payload: unknown) => {
        update(payload);
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { code: "23505", message: 'duplicate key value violates unique constraint "claims_one_live_value"' },
          }).then(resolve);
        return chain;
      };
      return chain;
    };
    try {
      await expect(
        result.current.fixFact.mutateAsync({ fact: fact({ value: "Englsh" }), value: "English" }),
      ).rejects.toBeInstanceOf(DuplicateFactValueError);
    } finally {
      client.from = original;
    }
  });

  it("turns the claim guards' raw messages into words", () => {
    expect(describeFactRefusal("claim_quality_guard")).not.toContain("claim_quality_guard");
    expect(
      describeClaimWriteError({
        code: "23514",
        message: "claim_quality_guard: the value is a placeholder or repeats the attribute (city)",
      }).message,
    ).toBe(describeFactRefusal("claim_quality_guard"));
    expect(
      describeClaimWriteError({
        code: "23514",
        message: "claim_evidence_required: automated facts need a verbatim source quote",
      }).message,
    ).toBe("A source quote is needed for this fact.");
  });

  it("today is the profile's day: IANA zones, and UTC for an empty or unknown zone (user_today)", () => {
    const now = new Date("2026-09-28T23:30:00Z");
    expect(todayInTimeZone("Europe/Berlin", now)).toBe("2026-09-29");
    expect(todayInTimeZone("America/New_York", now)).toBe("2026-09-28");
    expect(todayInTimeZone("", now)).toBe("2026-09-28");
    expect(todayInTimeZone(null, now)).toBe("2026-09-28");
    expect(todayInTimeZone("Mars/Olympus", now)).toBe("2026-09-28");
  });

  it("No longer true and Keep this one end values on the profile's day, not the browser's", async () => {
    // 12:00 UTC is already tomorrow on Kiritimati (UTC+14), whatever zone this machine is in.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    try {
      rows.timezone = "Pacific/Kiritimati";
      const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
      await result.current.endFact.mutateAsync({ fact: fact() });
      const [end] = fake.current!.on("claims", "update");
      expect(end.payload).toEqual({ valid_to: "2026-09-29" });

      const [slot] = groupSlots([
        fact({ claim_id: "a", value: "Berlin", has_conflict: true }),
        fact({ claim_id: "b", value: "London", has_conflict: true }),
      ]);
      await result.current.keepOnly.mutateAsync({ slot, keep: slot.current[0] });
      const keep = fake.current!.on("claims", "update")[1];
      expect(keep.payload).toEqual({ valid_to: "2026-09-29" });
      await waitFor(() => expect(result.current.actions.today!()).toBe("2026-09-29"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("Fix the date moves a mistyped future start, and the value it replaced ends on the new day", async () => {
    rows.facts = [
      fact({
        claim_id: "old",
        attribute: "current-city",
        label: "Current city",
        value: "Berlin",
        valid_from: "2020-01-01",
        valid_to: "2062-09-01",
      }),
      fact({
        claim_id: "new",
        attribute: "current-city",
        label: "Current city",
        value: "London",
        valid_from: "2062-09-01",
        is_current: false,
      }),
    ];
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.facts).toHaveLength(2));
    await result.current.redateFact.mutateAsync({ fact: rows.facts[1], validFrom: "2026-09-01" });
    const [start, previous] = fake.current!.on("claims", "update");
    expect(filterValue(start, "eq", "id")).toBe("new");
    expect(start.payload).toMatchObject({ valid_from: "2026-09-01" });
    expect(filterValue(previous, "in", "id")).toEqual(["old"]);
    expect(previous.payload).toEqual({ valid_to: "2026-09-01" });
  });

  it("Fix the date refuses a start on or after the day the value ended", async () => {
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await expect(
      result.current.redateFact.mutateAsync({
        fact: fact({ valid_from: "2020-01-01", valid_to: "2024-01-01", is_current: false }),
        validFrom: "2025-01-01",
      }),
    ).rejects.toThrow("The start has to be before the day it ended (2024-01-01).");
    expect(fake.current!.on("claims", "update")).toHaveLength(0);
  });

  it("Was wrong on a value dated in the future: the value it was to replace no longer ends then", async () => {
    rows.facts = [
      fact({ claim_id: "old", attribute: "current-city", value: "Berlin", valid_to: "2062-09-01" }),
      fact({ claim_id: "new", attribute: "current-city", value: "London", valid_from: "2062-09-01", is_current: false }),
    ];
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.facts).toHaveLength(2));
    await result.current.retract.mutateAsync(rows.facts[1]);
    const [del] = fake.current!.on("claims", "delete");
    expect(filterValue(del, "eq", "id")).toBe("new");
    const [reopen] = fake.current!.on("claims", "update");
    expect(filterValue(reopen, "in", "id")).toEqual(["old"]);
    expect(reopen.payload).toEqual({ valid_to: null });
  });

  it("Still true reopens an ended value, unless the same value is already current", async () => {
    rows.facts = [
      fact({ claim_id: "live", value: "German" }),
      fact({ claim_id: "ended", value: "French", is_current: false, valid_to: "2026-01-01" }),
      fact({ claim_id: "again", value: "german", is_current: false, valid_to: "2025-01-01" }),
    ];
    const { result } = renderHook(() => useFacts({ type: "contact", id: "p1" }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.facts).toHaveLength(3));
    await result.current.reopenFact.mutateAsync(rows.facts[1]);
    const [update] = fake.current!.on("claims", "update");
    expect(update.payload).toEqual({ valid_to: null });
    expect(filterValue(update, "eq", "id")).toBe("ended");
    await expect(result.current.reopenFact.mutateAsync(rows.facts[2])).rejects.toThrow("is already a current value");
    expect(fake.current!.on("claims", "update")).toHaveLength(1);
  });
});
