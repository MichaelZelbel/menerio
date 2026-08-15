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
}

const autoNormalizationInFlight = new Set<string>();
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
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        autoNormalizationSeen.add(key);
        const totals = (data as any)?.totals;
        const changed = Number(totals?.applied || 0) + Number(totals?.review || 0) + Number(totals?.created || 0);
        if (changed > 0) {
          qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["pending-profile-suggestions", userId, contactId] });
          qc.invalidateQueries({ queryKey: ["review-queue"] });
          triggerPeopleSync({ people: [contactId] });
        }
      })
      .catch((err) => {
        console.error("[normalize-profile] automatic contact cleanup failed", err);
      })
      .finally(() => {
        autoNormalizationInFlight.delete(key);
      });
  }, [categoriesQuery.isLoading, contactId, entriesQuery.data, entriesQuery.isLoading, qc, triggerPeopleSync, userId]);

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
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      // Hard delete — no updated_at trace; force the page.
      triggerPeopleSync(contactId ? { people: [contactId] } : undefined);
      showToast.success("Entry deleted");
    },
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
