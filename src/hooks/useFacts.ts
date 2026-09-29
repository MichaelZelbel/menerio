import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeopleSync } from "@/hooks/usePeopleSync";
import { todayISO } from "@/lib/claims";
import { taxonomyBySlug, taxonomyOrder } from "@/lib/profile-taxonomy";
import type { ProfileCategory } from "@/hooks/useProfile";
import { BRAND } from "@/lib/brand";

/**
 * Facts on a person page (docs/plans/one-fact-store.md, 3.5 and 3.7).
 *
 * A fact is a `claims` row. How one attribute of one subject is displayed
 * (label, section, pin, "show to assistants", one answer or several) is its
 * `fact_slots` row. The page reads both through the `profile_facts` view,
 * which RLS limits to the signed-in user.
 *
 * - Adding goes through the `write_fact` edge action (the one add path, with
 *   the user's JWT, so the claim guards see a human).
 * - Ending, correcting and deleting are direct `claims` writes.
 * - Display changes are direct `fact_slots` writes.
 */

export type FactSubject =
  | { type: "self"; id?: null }
  | { type: "contact"; id: string }
  | { type: "entity"; id: string };

export interface ProfileFact {
  claim_id: string;
  user_id: string;
  subject_type: "self" | "contact" | "entity";
  subject_id: string | null;
  contact_id: string | null;
  attribute: string;
  value: string;
  valid_from: string | null;
  valid_to: string | null;
  is_current: boolean;
  confidence: string | null;
  cardinality: string | null;
  origin: string | null;
  rank: string | null;
  evidence_quote: string | null;
  source_type: string | null;
  source_id: string | null;
  review_by: string | null;
  created_at: string;
  updated_at: string;
  slot_id: string | null;
  label: string;
  category_slug: string | null;
  category_name: string | null;
  visibility_scope: string;
  is_pinned: boolean;
  show_to_agent: boolean;
  has_conflict: boolean;
}

/** One attribute of the subject: its current values and its history. */
export interface FactSlot {
  /** slot_id, or `attr:<attribute>` for a claim that has no slot row yet. */
  key: string;
  slotId: string | null;
  attribute: string;
  label: string;
  categorySlug: string | null;
  isPinned: boolean;
  showToAgent: boolean;
  hasConflict: boolean;
  /** Current values, oldest first ("German, English"). */
  current: ProfileFact[];
  /** Ended values (and values that start in the future), newest first. */
  history: ProfileFact[];
}

/** Section key for facts filed in no section. */
export const OTHER_SECTION = "__other__";

export interface FactSection {
  key: string;
  slug: string | null;
  name: string;
  icon: string;
  visibilityScope: string;
  /** The subject's own profile_categories row, when one exists. */
  category: ProfileCategory | null;
  slots: FactSlot[];
}

export type SlotPatch = Partial<{
  label: string;
  category_slug: string | null;
  is_pinned: boolean;
  show_to_agent: boolean;
  cardinality: "one" | "many" | null;
}>;

export interface AddFactInput {
  label: string;
  value: string;
  category_slug?: string | null;
  valid_from?: string | null;
  is_pinned?: boolean;
  /** A note the fact comes from (optional). */
  linked_note_id?: string | null;
}

/** Everything a fact list can do, passed down to the section components. */
export interface FactActions {
  add: (input: AddFactInput) => void;
  /** "It changed": the new value from `validFrom`; the old one becomes history. */
  changed: (fact: ProfileFact, value: string, validFrom: string) => void;
  /** "Fix a mistake": the value is corrected in place. */
  fix: (fact: ProfileFact, value: string) => void;
  /** "No longer true": the value ends and stays as history. */
  end: (fact: ProfileFact, date?: string) => void;
  /** "Was wrong": the value is deleted and never suggested again. */
  retract: (fact: ProfileFact) => void;
  /** Label, section, pin, show to assistants, "Both are true". */
  updateSlot: (slot: FactSlot, patch: SlotPatch) => void;
  /** "Keep this one" on a two-answers badge: the other current values end today. */
  keepOnly: (slot: FactSlot, keep: ProfileFact) => void;
}

const FACT_COLUMNS =
  "claim_id, user_id, subject_type, subject_id, contact_id, attribute, value, valid_from, valid_to, is_current, confidence, cardinality, origin, rank, evidence_quote, source_type, source_id, review_by, created_at, updated_at, slot_id, label, category_slug, category_name, visibility_scope, is_pinned, show_to_agent, has_conflict";

const norm = (value: string) => String(value ?? "").trim().toLowerCase();

export function subjectKey(subject: FactSubject | null): string {
  if (!subject) return "none";
  return subject.type === "self" ? "self" : `${subject.type}:${subject.id}`;
}

function subjectIdOf(subject: FactSubject): string | null {
  return subject.type === "self" ? null : subject.id;
}

/** The key writeFact checks before adding a value (fact-store.ts suppressionKey). */
export function factSuppressionKey(
  fact: Pick<ProfileFact, "subject_type" | "subject_id" | "attribute">,
  value: string,
): string {
  return `${fact.subject_type}:${fact.subject_id ?? ""}:${fact.attribute}:${norm(value)}`;
}

/** The attribute as a label writeFact turns back into the same attribute. */
export function attributeLabel(attribute: string): string {
  return attribute.replace(/-/g, " ").trim();
}

/** Group a subject's facts into slots (one per attribute). Pure. */
export function groupSlots(facts: ProfileFact[]): FactSlot[] {
  const byKey = new Map<string, FactSlot>();
  for (const fact of facts) {
    const key = fact.slot_id ?? `attr:${fact.attribute}`;
    let slot = byKey.get(key);
    if (!slot) {
      slot = {
        key,
        slotId: fact.slot_id,
        attribute: fact.attribute,
        label: fact.label,
        categorySlug: fact.category_slug,
        isPinned: fact.is_pinned,
        showToAgent: fact.show_to_agent,
        hasConflict: false,
        current: [],
        history: [],
      };
      byKey.set(key, slot);
    }
    if (fact.is_current) {
      slot.current.push(fact);
      if (fact.has_conflict) slot.hasConflict = true;
    } else {
      slot.history.push(fact);
    }
  }
  for (const slot of byKey.values()) {
    slot.current.sort(
      (a, b) =>
        (a.valid_from ?? "").localeCompare(b.valid_from ?? "") || a.created_at.localeCompare(b.created_at),
    );
    // Newest first; a value that starts in the future (no end yet) leads.
    slot.history.sort(
      (a, b) =>
        (b.valid_to ?? "9999-12-31").localeCompare(a.valid_to ?? "9999-12-31") ||
        b.created_at.localeCompare(a.created_at),
    );
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Sections in taxonomy order (custom sections after, by name; "Other" last),
 * each holding its slots. A section shows when it has a slot with a current
 * value or history, or when it is an empty custom section (so a new custom
 * section is never a dead end). Pure.
 */
export function groupFacts(facts: ProfileFact[], categories: ProfileCategory[] = []): FactSection[] {
  const sections = new Map<string, FactSection>();
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  const sectionFor = (slug: string | null, fallbackName: string | null): FactSection => {
    const key = slug ?? OTHER_SECTION;
    let section = sections.get(key);
    if (!section) {
      const category = slug ? categoryBySlug.get(slug) ?? null : null;
      const meta = slug ? taxonomyBySlug[slug] : undefined;
      section = {
        key,
        slug,
        name:
          category?.name ??
          fallbackName ??
          meta?.name ??
          (slug ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ") : "Other"),
        icon: category?.icon ?? meta?.icon ?? "folder",
        visibilityScope: category?.visibility_scope ?? "all",
        category,
        slots: [],
      };
      sections.set(key, section);
    }
    return section;
  };

  for (const slot of groupSlots(facts)) {
    const first = slot.current[0] ?? slot.history[0];
    sectionFor(slot.categorySlug, first?.category_name ?? null).slots.push(slot);
  }
  for (const category of categories) {
    if (!sections.has(category.slug) && !(category.slug in taxonomyBySlug)) {
      sectionFor(category.slug, null);
    }
  }

  return [...sections.values()].sort((a, b) => {
    if (a.key === OTHER_SECTION) return 1;
    if (b.key === OTHER_SECTION) return -1;
    return taxonomyOrder(a.slug!) - taxonomyOrder(b.slug!) || a.name.localeCompare(b.name);
  });
}

/** Read the status and JSON body of a failed functions.invoke. */
async function readInvokeFailure(error: unknown): Promise<{ status: number | null; body: any }> {
  const ctx = (error as { context?: { status?: number; json?: () => Promise<unknown>; clone?: () => any } })?.context;
  const status = typeof ctx?.status === "number" ? ctx.status : null;
  let body: any = null;
  try {
    const source = typeof ctx?.clone === "function" ? ctx.clone() : ctx;
    if (source && typeof source.json === "function") body = await source.json();
  } catch {
    /* no body */
  }
  return { status, body };
}

export const PAUSED_MESSAGE = `${BRAND.name} is updating, try again in a few minutes.`;

/** Turns a refusal reason from writeFact into a sentence the user can act on. */
export function describeFactRefusal(reason: string | null | undefined): string {
  switch (reason) {
    case "relationships_are_links":
      return "Relationships are managed in the Relationships section, not as facts.";
    case "contact_not_found":
      return "This person could not be found.";
    case "entity_not_found":
      return "This could not be found in World.";
    case "bad_date":
      return "That date is not valid.";
    case "nothing_fileable":
    case "empty_attribute":
      return "There was nothing to save in that fact.";
    case "evidence_required":
      return "A source quote is needed for this fact.";
    case "blocked_label":
      return "That field is not stored on profiles (relationships and purchases live elsewhere).";
    default:
      return reason ? `The fact was not saved (${reason}).` : "The fact was not saved.";
  }
}

export interface WriteFactOutcome {
  attribute: string | null;
  outcome: "inserted" | "already_recorded" | "history_not_revived" | "suppressed" | "rejected";
  claimId?: string;
  closed?: number;
  conflict?: boolean;
  reason?: string;
}

export interface WriteFactBody {
  contact_id?: string | null;
  entity_id?: string | null;
  label: string;
  /** An existing slot's key: the server uses it as is instead of re-deriving it from the label. */
  attribute?: string | null;
  value: string;
  category_slug?: string | null;
  valid_from?: string | null;
  is_pinned?: boolean;
  source_type?: "note" | "moment" | "manual" | "ai" | "lexicon" | null;
  source_id?: string | null;
}

/**
 * Add a fact through normalize-profile `write_fact`. Throws an Error with a
 * readable message when the server refused it, was paused, or failed.
 */
export async function invokeWriteFact(body: WriteFactBody): Promise<{ ok: boolean; facts: WriteFactOutcome[] }> {
  const { data, error } = await supabase.functions.invoke("normalize-profile", {
    body: { action: "write_fact", ...body },
  });
  if (error) {
    const { status, body: failure } = await readInvokeFailure(error);
    if (status === 503 || failure?.error === "paused") throw new Error(PAUSED_MESSAGE);
    const reason = (failure?.facts as WriteFactOutcome[] | undefined)?.find((f) => f.reason)?.reason ?? failure?.reason;
    if (status === 409 || reason) throw new Error(describeFactRefusal(reason));
    throw new Error((error as Error).message || "The fact was not saved.");
  }
  if (!data?.ok) {
    const reason = (data?.facts as WriteFactOutcome[] | undefined)?.find((f) => f.reason)?.reason ?? data?.reason;
    throw new Error(describeFactRefusal(reason));
  }
  return { ok: true, facts: (data.facts ?? []) as WriteFactOutcome[] };
}

/** What to tell the user after a successful write_fact. */
export function describeWriteResult(facts: WriteFactOutcome[]): { kind: "success" | "info"; message: string } {
  const inserted = facts.filter((f) => f.outcome === "inserted");
  if (inserted.length > 0) {
    const closed = inserted.reduce((n, f) => n + (f.closed ?? 0), 0);
    if (inserted.some((f) => f.conflict)) {
      return { kind: "info", message: "Fact saved. It disagrees with another value, so both are shown as two answers." };
    }
    return {
      kind: "success",
      message: closed > 0 ? "Fact saved. The previous value moved to history." : "Fact saved",
    };
  }
  if (facts.some((f) => f.outcome === "suppressed")) {
    return { kind: "info", message: "Not added: you marked this value as wrong before." };
  }
  return { kind: "info", message: "Already recorded" };
}

/** Every cached view of facts, so a change shows everywhere at once. */
export function invalidateFactViews(qc: QueryClient) {
  for (const key of [
    "profile-facts",
    "profile-summary",
    "claims",
    "world-claims",
    "relationship-genders",
    "ai_footprint",
  ]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Remember a value as "do not suggest again" (plan 3.2: suggestion_type
 * 'claim', key subject_type:subject_id:attribute:value).
 */
export async function suppressFactValue(
  fact: Pick<ProfileFact, "claim_id" | "subject_type" | "subject_id" | "attribute" | "category_slug">,
  value: string,
) {
  const { error } = await supabase.from("ai_suggestion_suppressions").upsert(
    {
      suggestion_type: "claim",
      target_entity_type: "claim",
      target_entity_id: fact.claim_id,
      normalized_value: norm(value),
      source_category: fact.category_slug ?? null,
      suppression_key: factSuppressionKey(fact, value),
    },
    { onConflict: "user_id,suppression_key" },
  );
  if (error) throw error;
}

/**
 * "Was wrong": remember the value as not to be suggested again, and delete
 * the claim. The suppression goes first (as in review-queue-bulk): should the
 * delete fail, the value still never comes back, and the user can retry.
 */
export async function retractFact(
  fact: Pick<ProfileFact, "claim_id" | "subject_type" | "subject_id" | "attribute" | "category_slug" | "value">,
) {
  await suppressFactValue(fact, fact.value);
  const { data, error } = await supabase.from("claims").delete().eq("id", fact.claim_id).select("id");
  if (error) throw error;
  // A claim guard can cancel a delete without an error; say so.
  if (!data || data.length === 0) throw new Error("The fact could not be deleted.");
}

export function useFacts(subject: FactSubject | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  const { triggerPeopleSync } = usePeopleSync();
  const subjectType = subject?.type ?? null;
  const subjectId = subject ? subjectIdOf(subject) : null;
  const queryKey = ["profile-facts", userId, subjectKey(subject)];

  const factsQuery = useQuery({
    queryKey,
    enabled: !!userId && !!subject && (subject.type === "self" || !!subjectId),
    queryFn: async () => {
      let q = supabase
        .from("profile_facts")
        .select(FACT_COLUMNS)
        .eq("user_id", userId!)
        .eq("subject_type", subjectType!);
      q = subjectId === null ? q.is("subject_id", null) : q.eq("subject_id", subjectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ProfileFact[];
    },
  });

  const facts = useMemo(() => factsQuery.data ?? [], [factsQuery.data]);
  const currentFacts = useMemo(() => facts.filter((f) => f.is_current), [facts]);
  const slots = useMemo(() => groupSlots(facts), [facts]);
  /** Sections from the taxonomy alone; pages that have the subject's section rows call groupFacts with them. */
  const sections = useMemo(() => groupFacts(facts), [facts]);

  const afterWrite = () => {
    invalidateFactViews(qc);
    if (subject?.type === "contact") triggerPeopleSync({ people: [subject.id] });
    else if (subject?.type === "self") triggerPeopleSync();
  };

  const onError = (error: Error) => showToast.error(error?.message || "Could not save the change");

  const subjectBody = (): Pick<WriteFactBody, "contact_id" | "entity_id"> =>
    subject?.type === "contact"
      ? { contact_id: subject.id }
      : subject?.type === "entity"
        ? { entity_id: subject.id }
        : {};

  const addFact = useMutation({
    mutationFn: async (input: AddFactInput) => {
      if (!subject) throw new Error("Nothing to add the fact to");
      return invokeWriteFact({
        ...subjectBody(),
        label: input.label.trim(),
        value: input.value.trim(),
        category_slug: subject.type === "entity" ? null : input.category_slug ?? null,
        valid_from: input.valid_from ?? null,
        is_pinned: input.is_pinned,
        source_type: input.linked_note_id ? "note" : undefined,
        source_id: input.linked_note_id ?? undefined,
      });
    },
    onSuccess: (result) => {
      afterWrite();
      const told = describeWriteResult(result.facts);
      if (told.kind === "success") showToast.success(told.message);
      else showToast.info(told.message);
    },
    onError,
  });

  const changeFact = useMutation({
    mutationFn: async ({ fact, value, validFrom }: { fact: ProfileFact; value: string; validFrom: string }) => {
      if (!subject) throw new Error("Nothing to change");
      const result = await invokeWriteFact({
        ...subjectBody(),
        label: fact.label || attributeLabel(fact.attribute),
        attribute: fact.attribute,
        value: value.trim(),
        category_slug: fact.category_slug,
        valid_from: validFrom,
      });
      // A single-valued attribute is closed by writeFact. For a list ("one of
      // my languages changed") the old value is ended here, so it becomes
      // history in both cases.
      const inserted = result.facts.some((f) => f.outcome === "inserted");
      if (inserted && norm(value) !== norm(fact.value) && (!fact.valid_from || fact.valid_from <= validFrom)) {
        const { error } = await supabase
          .from("claims")
          .update({ valid_to: validFrom })
          .eq("id", fact.claim_id)
          .is("valid_to", null);
        if (error) throw error;
      }
      return result;
    },
    onSuccess: (result) => {
      afterWrite();
      const inserted = result.facts.some((f) => f.outcome === "inserted");
      if (inserted) showToast.success("Updated. The previous value moved to history.");
      else showToast.info(describeWriteResult(result.facts).message);
    },
    onError,
  });

  const fixFact = useMutation({
    mutationFn: async ({ fact, value }: { fact: ProfileFact; value: string }) => {
      const next = value.trim();
      if (!next) throw new Error("A value is required");
      if (next === fact.value) return;
      const { error } = await supabase.from("claims").update({ value: next }).eq("id", fact.claim_id);
      if (error) throw error;
      // A machine's value that needed fixing was never true: do not suggest it again.
      if (fact.origin !== "user_manual" && norm(next) !== norm(fact.value)) {
        await suppressFactValue(fact, fact.value);
      }
    },
    onSuccess: () => {
      afterWrite();
      showToast.success("Fact corrected");
    },
    onError,
  });

  const endFact = useMutation({
    mutationFn: async ({ fact, date }: { fact: ProfileFact; date?: string }) => {
      const { error } = await supabase
        .from("claims")
        .update({ valid_to: date || todayISO() })
        .eq("id", fact.claim_id);
      if (error) throw error;
    },
    onSuccess: () => {
      afterWrite();
      showToast.success("Moved to history");
    },
    onError,
  });

  const retract = useMutation({
    mutationFn: async (fact: ProfileFact) => retractFact(fact),
    onSuccess: () => {
      afterWrite();
      showToast.success("Removed. It will not be suggested again.");
    },
    onError,
  });

  const updateSlot = useMutation({
    mutationFn: async ({ slot, patch }: { slot: FactSlot; patch: SlotPatch }) => {
      if (!subject || !userId) throw new Error("Nothing to change");
      if (patch.label !== undefined && !patch.label.trim()) throw new Error("A label is required");
      const clean: SlotPatch = { ...patch };
      if (clean.label !== undefined) clean.label = clean.label.trim();
      if (slot.slotId) {
        const { error } = await supabase.from("fact_slots").update(clean).eq("id", slot.slotId);
        if (error) throw error;
        return;
      }
      // A claim with no slot row yet (a machine wrote it without one): create it.
      const { error } = await supabase.from("fact_slots").insert({
        user_id: userId,
        subject_type: subject.type,
        subject_id: subjectId,
        attribute: slot.attribute,
        label: slot.label,
        category_slug: subject.type === "entity" ? null : slot.categorySlug,
        ...clean,
      });
      if (!error) return;
      if ((error as { code?: string }).code !== "23505") throw error;
      let q = supabase
        .from("fact_slots")
        .update(clean)
        .eq("user_id", userId)
        .eq("subject_type", subject.type)
        .eq("attribute", slot.attribute);
      q = subjectId === null ? q.is("subject_id", null) : q.eq("subject_id", subjectId);
      const { error: updateError } = await q;
      if (updateError) throw updateError;
    },
    onSuccess: () => afterWrite(),
    onError,
  });

  const keepOnly = useMutation({
    mutationFn: async ({ slot, keep }: { slot: FactSlot; keep: ProfileFact }) => {
      const others = slot.current.filter((f) => f.claim_id !== keep.claim_id).map((f) => f.claim_id);
      if (others.length === 0) return;
      const { error } = await supabase.from("claims").update({ valid_to: todayISO() }).in("id", others);
      if (error) throw error;
    },
    onSuccess: () => {
      afterWrite();
      showToast.success("Kept one answer. The other moved to history.");
    },
    onError,
  });

  const actions: FactActions = {
    add: (input) => addFact.mutate(input),
    changed: (fact, value, validFrom) => changeFact.mutate({ fact, value, validFrom }),
    fix: (fact, value) => fixFact.mutate({ fact, value }),
    end: (fact, date) => endFact.mutate({ fact, date }),
    retract: (fact) => retract.mutate(fact),
    updateSlot: (slot, patch) => updateSlot.mutate({ slot, patch }),
    keepOnly: (slot, keep) => keepOnly.mutate({ slot, keep }),
  };

  return {
    /** Every row: current values and history. */
    facts,
    /** Current values only. */
    currentFacts,
    slots,
    sections,
    isLoading: factsQuery.isLoading,
    error: factsQuery.error,
    actions,
    addFact,
    changeFact,
    fixFact,
    endFact,
    retract,
    updateSlot,
    keepOnly,
  };
}
