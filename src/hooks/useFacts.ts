import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeopleSync } from "@/hooks/usePeopleSync";
import { reviewByFor, todayISO } from "@/lib/claims";
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
  /** "Fix the date": the value starts on another day; the value it replaced ends that day. */
  redate: (fact: ProfileFact, validFrom: string) => void;
  /** "Still true" on a history row: the value is current again. */
  reopen: (fact: ProfileFact) => void;
  /** "No longer true": the value ends and stays as history. */
  end: (fact: ProfileFact, date?: string) => void;
  /** "Was wrong": the value is deleted and never suggested again. */
  retract: (fact: ProfileFact) => void;
  /** Label, section, pin, show to assistants, "Both are true". */
  updateSlot: (slot: FactSlot, patch: SlotPatch) => void;
  /** "Keep this one" on a two-answers badge: the other current values end today. */
  keepOnly: (slot: FactSlot, keep: ProfileFact) => void;
  /**
   * The profile's own today (YYYY-MM-DD), the day the views use to decide
   * what is current. Forms default to it, so a change dated "today" is
   * current at once instead of waiting for the profile's midnight.
   */
  today?: () => string;
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
    // The database's own guards on claims (writeFact passes the part before the colon).
    case "claim_quality_guard":
      return PLACEHOLDER_MESSAGE;
    case "claim_evidence_required":
      return "A source quote is needed for this fact.";
    case "claim_origin_required":
      return "The fact was not saved. Reload the page and try again.";
    default:
      return reason ? `The fact was not saved (${reason}).` : "The fact was not saved.";
  }
}

const PLACEHOLDER_MESSAGE =
  'Not saved: the value is empty, a placeholder such as "none" or "unknown", or repeats the field\'s name.';

/**
 * "Fix a mistake" to a value the fact already holds as another live value.
 * The database allows one live copy of a value per attribute, so nothing is
 * written; the page offers to remove the mistaken entry instead.
 */
export class DuplicateFactValueError extends Error {
  constructor(
    readonly fact: ProfileFact,
    value: string,
  ) {
    super(`"${value}" is already recorded under ${fact.label || attributeLabel(fact.attribute)}, so this entry was not changed.`);
    this.name = "DuplicateFactValueError";
  }
}

/**
 * A direct `claims` write refused by the database, in words. The raw text
 * names an index or a guard ("claims_one_live_value", "claim_quality_guard:
 * ..."), which means nothing to the person who typed the value.
 */
export function describeClaimWriteError(error: unknown): Error {
  const e = error as { code?: string; message?: string } | null;
  const message = String(e?.message ?? "");
  // The guards share one error code, so the message's prefix decides.
  if (message.startsWith("claim_origin_required") || message.startsWith("claim_evidence_required")) {
    return new Error(describeFactRefusal(message.split(":")[0]));
  }
  if (e?.code === "23514" || message.startsWith("claim_quality_guard")) return new Error(PLACEHOLDER_MESSAGE);
  return error instanceof Error ? error : new Error(message || "Could not save the change");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today (YYYY-MM-DD) in an IANA time zone: what `user_today` computes with
 * `(now() AT TIME ZONE tz)::date`, and so what `profile_facts.is_current` and
 * `fact_today` use. An empty or unknown zone counts as UTC, as there.
 */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  const day = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const zone = String(timeZone ?? "").trim() || "UTC";
  try {
    const result = day(zone);
    if (ISO_DAY.test(result)) return result;
  } catch {
    /* an unknown zone: UTC, as user_today does */
  }
  return day("UTC");
}

/** The signed-in person's profile time zone (profiles.timezone); null when there is no row. */
function profileTimeZoneQuery(userId: string | undefined) {
  return {
    queryKey: ["profile-timezone", userId],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("timezone").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return ((data as { timezone?: string | null } | null)?.timezone ?? null) as string | null;
    },
  };
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

  // "Today" is the profile's day, the one profile_facts decides "current" with.
  // The browser's day disagreed around midnight: a change dated with it stayed
  // in the future, and "No longer true" or "Keep this one" left the value (and
  // the two-answers badge) current until the profile's midnight.
  const timeZone = useQuery({ ...profileTimeZoneQuery(userId), enabled: !!userId });
  const today = useCallback(
    () => (timeZone.data === undefined ? todayISO() : todayInTimeZone(timeZone.data)),
    [timeZone.data],
  );
  const resolveToday = async () => {
    try {
      return todayInTimeZone(await qc.fetchQuery(profileTimeZoneQuery(userId)));
    } catch {
      return todayISO();
    }
  };

  /** Another live copy of this value under the same attribute (the database allows one). */
  const liveTwin = (fact: ProfileFact, value: string) =>
    facts.find(
      (f) => f.claim_id !== fact.claim_id && f.attribute === fact.attribute && f.valid_to === null && norm(f.value) === norm(value),
    );

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
      if (!ISO_DAY.test(validFrom)) throw new Error(describeFactRefusal("bad_date"));
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
      // history in both cases. A value already set to end later (an earlier
      // change dated in the future) ends on the new day too; left alone, it
      // stayed current beside its replacement as two answers.
      const inserted = result.facts.some((f) => f.outcome === "inserted");
      if (inserted && norm(value) !== norm(fact.value) && (!fact.valid_from || fact.valid_from <= validFrom)) {
        const { error } = await supabase
          .from("claims")
          .update({ valid_to: validFrom })
          .eq("id", fact.claim_id)
          .or(`valid_to.is.null,valid_to.gt.${validFrom}`);
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

  const retract = useMutation({
    mutationFn: async (fact: ProfileFact) => {
      await retractFact(fact);
      // A value "It changed" dated in the future ended the value it replaces on
      // that day. It never happened, so that value no longer ends then.
      const futureDated = !fact.is_current && fact.valid_to === null && !!fact.valid_from;
      const replaced = futureDated
        ? facts.filter((f) => f.claim_id !== fact.claim_id && f.attribute === fact.attribute && f.valid_to === fact.valid_from)
        : [];
      if (replaced.length === 0) return { stillEnds: null as string | null };
      const { error } = await supabase
        .from("claims")
        .update({ valid_to: null })
        .in(
          "id",
          replaced.map((f) => f.claim_id),
        );
      return { stillEnds: error ? fact.valid_from : null };
    },
    onSuccess: ({ stillEnds }) => {
      afterWrite();
      if (stillEnds) showToast.warning(`Removed. The value it was to replace still ends on ${stillEnds}.`);
      else showToast.success("Removed. It will not be suggested again.");
    },
    onError,
  });

  const fixFact = useMutation({
    mutationFn: async ({ fact, value }: { fact: ProfileFact; value: string }) => {
      const next = value.trim();
      if (!next) throw new Error("A value is required");
      if (next === fact.value) return false;
      // One live copy of a value per attribute (claims_one_live_value): fixing
      // "Englsh" into an "English" that is already there is refused by the
      // database, whose message named the index.
      if (fact.valid_to === null && liveTwin(fact, next)) throw new DuplicateFactValueError(fact, next);
      const { error } = await supabase.from("claims").update({ value: next }).eq("id", fact.claim_id);
      if (error) {
        if ((error as { code?: string }).code === "23505") throw new DuplicateFactValueError(fact, next);
        throw describeClaimWriteError(error);
      }
      // A machine's value that needed fixing was never true: do not suggest it again.
      if (fact.origin !== "user_manual" && norm(next) !== norm(fact.value)) {
        await suppressFactValue(fact, fact.value);
      }
      return true;
    },
    onSuccess: (changed) => {
      if (!changed) return;
      afterWrite();
      showToast.success("Fact corrected");
    },
    onError: (error: Error) => {
      if (error instanceof DuplicateFactValueError) {
        const mistaken = error.fact;
        toast.info(error.message, {
          action: { label: "Remove this entry", onClick: () => retract.mutate(mistaken) },
        });
        return;
      }
      onError(error);
    },
  });

  const redateFact = useMutation({
    mutationFn: async ({ fact, validFrom }: { fact: ProfileFact; validFrom: string }) => {
      if (!ISO_DAY.test(validFrom)) throw new Error(describeFactRefusal("bad_date"));
      if (fact.valid_from === validFrom) return { changed: false, moved: 0 };
      if (fact.valid_to && validFrom >= fact.valid_to) {
        throw new Error(`The start has to be before the day it ended (${fact.valid_to}).`);
      }
      const { error } = await supabase
        .from("claims")
        .update({ valid_from: validFrom, review_by: reviewByFor(fact.attribute, validFrom) })
        .eq("id", fact.claim_id);
      if (error) throw describeClaimWriteError(error);
      // "It changed" ended the value this one replaced on the day it started.
      // It moves along, so the two stay back to back: a mistyped future date
      // no longer keeps the old value current until then.
      const replaced = fact.valid_from
        ? facts.filter(
            (f) =>
              f.claim_id !== fact.claim_id &&
              f.attribute === fact.attribute &&
              f.valid_to === fact.valid_from &&
              (!f.valid_from || f.valid_from < validFrom),
          )
        : [];
      if (replaced.length > 0) {
        const { error: moveError } = await supabase
          .from("claims")
          .update({ valid_to: validFrom })
          .in(
            "id",
            replaced.map((f) => f.claim_id),
          );
        if (moveError) throw describeClaimWriteError(moveError);
      }
      return { changed: true, moved: replaced.length };
    },
    onSuccess: ({ changed, moved }) => {
      if (!changed) return;
      afterWrite();
      showToast.success(moved > 0 ? "Date fixed. The value it replaced now ends that day." : "Date fixed");
    },
    onError,
  });

  const reopenFact = useMutation({
    mutationFn: async (fact: ProfileFact) => {
      const already = `"${fact.value}" is already a current value, so this one stays in history.`;
      if (liveTwin(fact, fact.value)) throw new Error(already);
      const { error } = await supabase.from("claims").update({ valid_to: null }).eq("id", fact.claim_id);
      if (error) {
        if ((error as { code?: string }).code === "23505") throw new Error(already);
        throw describeClaimWriteError(error);
      }
    },
    onSuccess: () => {
      afterWrite();
      showToast.success("It is current again");
    },
    onError,
  });

  const endFact = useMutation({
    mutationFn: async ({ fact, date }: { fact: ProfileFact; date?: string }) => {
      const { error } = await supabase
        .from("claims")
        .update({ valid_to: date || (await resolveToday()) })
        .eq("id", fact.claim_id);
      if (error) throw error;
    },
    onSuccess: () => {
      afterWrite();
      showToast.success("Moved to history");
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
      const { error } = await supabase.from("claims").update({ valid_to: await resolveToday() }).in("id", others);
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
    redate: (fact, validFrom) => redateFact.mutate({ fact, validFrom }),
    reopen: (fact) => reopenFact.mutate(fact),
    end: (fact, date) => endFact.mutate({ fact, date }),
    retract: (fact) => retract.mutate(fact),
    updateSlot: (slot, patch) => updateSlot.mutate({ slot, patch }),
    keepOnly: (slot, keep) => keepOnly.mutate({ slot, keep }),
    today,
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
    redateFact,
    reopenFact,
    endFact,
    retract,
    updateSlot,
    keepOnly,
  };
}
