import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeopleSync } from "@/hooks/usePeopleSync";
import type { ProfileCategory, ProfileEntry } from "./useProfile";

/**
 * A contact profile entry, including `is_pinned` (added by the
 * `people_ux_foundations` migration). The generated `src/integrations/
 * supabase/types.ts` hasn't been regenerated to include this column, so
 * queries/mutations below cast the client to `any` for it — same pattern
 * `usePeople.ts` uses for `is_favorite`/`last_viewed_at`.
 */
export interface ContactProfileEntry extends ProfileEntry {
  is_pinned: boolean;
  /** The claim (dated record) this row displays, if it has one. */
  derived_from_claim_id?: string | null;
}

const autoNormalizationInFlight = new Set<string>();
const claimAdoptionRequested = new Set<string>();
const autoNormalizationSeen = new Set<string>();

/** Turns a server refusal reason into a message the user can act on. */
function describeWriteFailure(reason: string | null | undefined): string {
  switch (reason) {
    case "suppressed_by_guard":
      return "This fact was refused by the duplicate guard and not saved. Try rephrasing it or editing the existing entry.";
    case "blocked_label":
      return "That field is not stored on profiles (relationships and purchases live elsewhere).";
    case "not_a_skill":
      return "That value isn't a skill — file it under another section.";
    case "category_unresolved":
      return "Could not resolve the section for this fact.";
    case "contact_not_found":
      return "This person could not be found.";
    default:
      return reason ? `Profile entry was not saved (${reason})` : "Profile entry was not saved";
  }
}


export function useContactProfile(contactId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  const { triggerPeopleSync } = usePeopleSync();

  const categoriesQuery = useQuery({
    queryKey: ["contact-profile-categories", userId, contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId!)
        .eq("contact_id", contactId!)
        .order("sort_order");
      if (error) throw error;
      return data as ProfileCategory[];
    },
    enabled: !!userId && !!contactId,
  });

  const entriesQuery = useQuery({
    queryKey: ["contact-profile-entries", userId, contactId],
    queryFn: async () => {
      // Cast to `any`: `is_pinned` (added by the people_ux_foundations
      // migration) isn't in the generated types.ts yet — same pattern as
      // usePeople.ts's is_favorite/last_viewed_at.
      const { data, error } = await (supabase as any)
        .from("profile_entries")
        .select("*")
        .eq("user_id", userId!)
        .eq("contact_id", contactId!)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((d) => ({
        ...d,
        is_pinned: d.is_pinned ?? false,
      })) as ContactProfileEntry[];
    },
    enabled: !!userId && !!contactId,
  });

  useEffect(() => {
    if (!userId || !contactId) return;
    if (categoriesQuery.isLoading || entriesQuery.isLoading) return;
    if (!entriesQuery.data) return;

    const signature = JSON.stringify(
      entriesQuery.data.map((entry) => ({
        id: entry.id,
        category_id: entry.category_id,
        label: entry.label,
        value: entry.value,
      })),
    );
    const key = `${userId}:${contactId}:${signature}`;
    if (autoNormalizationSeen.has(key) || autoNormalizationInFlight.has(key)) return;

    autoNormalizationInFlight.add(key);
    void supabase.functions
      .invoke("normalize-profile", {
        body: {
          action: "backfill",
          scope: "contact",
          contact_id: contactId,
          includeNotesContext: true,
          // Opening a page folds duplicates for free; the paid model plan runs
          // once a day from the note pipeline or from the Normalize button.
          deterministic_only: true,
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        autoNormalizationSeen.add(key);
        const totals = (data as any)?.totals;
        const changed = Number(totals?.applied || 0) + Number(totals?.review || 0) + Number(totals?.created || 0);
        // The backfill now always runs in the background (202 + `started`), so
        // refresh once shortly after it was kicked off.
        const started = (data as any)?.started === true;
        const refresh = () => {
          qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["pending-profile-suggestions", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["review-queue"] });
          triggerPeopleSync({ people: [contactId] });
        };
        if (changed > 0) refresh();
        else if (started) setTimeout(refresh, 15000);
      })

      .catch((err) => {
        console.error("[normalize-profile] automatic contact cleanup failed", err);
      })
      .finally(() => {
        autoNormalizationInFlight.delete(key);
      });
  }, [categoriesQuery.isLoading, contactId, entriesQuery.data, entriesQuery.isLoading, qc, triggerPeopleSync, userId]);

  // Claims written outside this page (add_claim, the review queue) get their
  // row in the list from promote-profile-entries, which runs after each note.
  // Opening a person runs it too, so a fact an agent just added is on the page
  // now, not after the next note. Once per person per session.
  useEffect(() => {
    if (!userId || !contactId) return;
    const key = `${userId}:${contactId}`;
    if (claimAdoptionRequested.has(key)) return;
    claimAdoptionRequested.add(key);
    void supabase.functions
      .invoke("promote-profile-entries", {
        body: { dry_run: false, include_contacts: true, pending_only: true, limit: 200 },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        if (Number((data as any)?.adopted || 0) + Number((data as any)?.adopt_linked || 0) > 0) {
          qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
        }
      })
      .catch((err) => {
        claimAdoptionRequested.delete(key);
        console.error("[promote-profile-entries] claim adoption failed", err);
      });
  }, [contactId, qc, userId]);

  // Every mutation below reports its own failure: the pages call plain
  // mutate() with no handler, so a refused write (including the duplicate
  // guard's reason that describeWriteFailure spells out) used to vanish.
  const upsertCategory = useMutation({
    mutationFn: async (cat: Partial<ProfileCategory> & { id?: string }) => {
      if (cat.id) {
        const { error } = await supabase.from("profile_categories").update(cat).eq("id", cat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profile_categories").insert({
          ...cat,
          user_id: userId!,
          contact_id: contactId!,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
      triggerPeopleSync();
      showToast.success("Category saved");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not save the category"),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      // Hard delete (cascades entries) — no updated_at trace; force the page.
      triggerPeopleSync(contactId ? { people: [contactId] } : undefined);
      showToast.success("Category deleted");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not delete the category"),
  });

  const upsertEntry = useMutation({
    mutationFn: async (entry: Partial<ContactProfileEntry> & { id?: string }) => {
      // Cast to `any`: see the entriesQuery comment above re: is_pinned.
      if (entry.id) {
        const { error } = await (supabase as any).from("profile_entries").update(entry).eq("id", entry.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.functions.invoke("normalize-profile", {
          body: {
            action: "write_profile_entry",
            entry: { ...entry, contact_id: contactId! },
          },
        });
        // A 409 arrives as a FunctionsHttpError whose `.context` is the
        // Response — read the server's reason so a refused write never looks
        // like a success (the guards can refuse silently at the DB level).
        let reason: string | null = data?.reason ?? null;
        if (error) {
          const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
          if (ctx?.json) {
            try {
              reason = ((await ctx.json()) as { reason?: string })?.reason ?? reason;
            } catch {
              /* keep the generic message */
            }
          }
        }
        if (error || !data?.ok) throw new Error(describeWriteFailure(reason));
      }

    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      // Saving an entry can materialize a NEW profile_categories row first
      // (the quick-add flow runs ensureProfileCategory, which inserts via the
      // raw client, right before committing). The categories cache has a long
      // staleTime, and ProfileFactsPanel only renders a section for entries
      // whose category_id is in that cache — so refresh it too, or the
      // just-added fact stays invisible until the next refetch.
      qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
      triggerPeopleSync();
      showToast.success("Entry saved");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not save the entry"),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      // Deleting a fact on purpose deletes its dated record too. Left alone,
      // the database would only END the claim (that is what it does when a
      // background job removes a row), and agents would still read it.
      const claimId = entriesQuery.data?.find((e) => e.id === id)?.derived_from_claim_id;
      if (claimId) {
        const { error: claimError } = await (supabase as any).from("claims").delete().eq("id", claimId);
        if (claimError) throw claimError;
      }
      const { error } = await supabase.from("profile_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      // Hard delete — no updated_at trace; force the page.
      triggerPeopleSync(contactId ? { people: [contactId] } : undefined);
      showToast.success("Entry deleted");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not delete the entry"),
  });

  return {
    categories: categoriesQuery.data ?? [],
    entries: entriesQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || entriesQuery.isLoading,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
  };
}
