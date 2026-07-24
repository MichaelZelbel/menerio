import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReviewQueue, type ReviewItem, type WikiRevisionReviewItem } from "@/hooks/useReviewQueue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showToast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { canonicalLabel, isSymmetricLabel, relationshipPairKey, type EntityRef } from "@/lib/relationship-canonical";
import {
  UserPlus,
  Link2,
  Check,
  X,
  FileText,
  Calendar,

  Inbox,
  User,
  BookOpen,
  Eye,
  RotateCcw,
  Users2,
  Sparkles,
} from "lucide-react";

const typeConfig: Record<string, { icon: typeof UserPlus; label: string; color: string }> = {
  add_contact: { icon: UserPlus, label: "Add to People", color: "text-green-500" },
  add_alias: { icon: User, label: "Add Alias", color: "text-cyan-500" },
  link_note: { icon: Link2, label: "Link Note", color: "text-purple-500" },
  add_profile_entry: { icon: User, label: "Profile Fact", color: "text-amber-500" },
  add_relationship: { icon: Link2, label: "Relationship", color: "text-indigo-500" },
  add_moment: { icon: Calendar, label: "Timeline Moment", color: "text-rose-500" },
  group_member_suggestion: { icon: Users2, label: "Group Member", color: "text-primary" },
  normalize_profile_entry: { icon: Sparkles, label: "Profile cleanup", color: "text-fuchsia-500" },
};

const truncateText = (text: string | null | undefined, length = 200) => {
  const value = (text || "").replace(/\s+/g, " ").trim();
  return value.length > length ? `${value.slice(0, length)}…` : value;
};

const buildLineDiff = (before: string | null, after: string) => {
  const oldLines = (before || "").split("\n").filter((line) => line.trim());
  const newLines = after.split("\n").filter((line) => line.trim());
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const removed = oldLines.filter((line) => !newSet.has(line)).slice(0, 3);
  const added = newLines.filter((line) => !oldSet.has(line)).slice(0, 3);
  return { removed, added };
};

export default function ReviewQueue() {
  const { user } = useAuth();
  const { items, wikiRevisions, isLoading, updateStatus } = useReviewQueue();
  const queryClient = useQueryClient();
  const [selectedWikiRevision, setSelectedWikiRevision] = useState<WikiRevisionReviewItem | null>(null);
  const [rollbackWikiRevision, setRollbackWikiRevision] = useState<WikiRevisionReviewItem | null>(null);
  const refreshReviewQueues = () => {
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["review-queue-count"] });
    queryClient.invalidateQueries({ queryKey: ["wiki-revision-review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["wiki-revision-review-count"] });
    queryClient.invalidateQueries({ queryKey: ["wiki-pages"] });
    queryClient.invalidateQueries({ queryKey: ["wiki-revisions"] });
  };

  const handleWikiLooksGood = async (revision: WikiRevisionReviewItem) => {
    const { error } = await supabase
      .from("wiki_revisions" as any)
      .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .eq("id", revision.id);
    if (error) {
      showToast.error("Could not review Lexicon update: " + error.message);
      return;
    }
    refreshReviewQueues();
    showToast.success("Lexicon update reviewed");
  };

  const rollbackWikiRevisionById = async (revisionId: string) => {
    const { error } = await supabase.rpc("wiki_rollback_revision" as any, { p_revision_id: revisionId });
    if (error) throw error;
  };

  const handleWikiRollback = async () => {
    if (!rollbackWikiRevision) return;
    try {
      await rollbackWikiRevisionById(rollbackWikiRevision.id);
    } catch (error: any) {
      showToast.error("Could not roll back Lexicon update: " + (error.message || "Unknown error"));
      return;
    }
    setRollbackWikiRevision(null);
    refreshReviewQueues();
    showToast.success("Rolled back");
  };

  const createSuppression = async (item: ReviewItem) => {
    const normalizedValue = String(item.extracted_value || item.payload?.name || item.payload?.value || item.payload?.alias || item.title).trim().toLowerCase();
    const suppressionKey = item.suppression_key || `${item.suggestion_type}:${item.target_entity_type || "none"}:${item.target_entity_id || "none"}:${normalizedValue}`;
    await supabase.from("ai_suggestion_suppressions" as any).upsert({
      user_id: item.user_id,
      suggestion_type: item.suggestion_type,
      target_entity_type: item.target_entity_type,
      target_entity_id: item.target_entity_id,
      normalized_value: normalizedValue,
      source_category: typeof item.payload?.category_slug === "string" ? item.payload.category_slug : null,
      suppression_key: suppressionKey,
    } as any, { onConflict: "user_id,suppression_key" });
  };

  const invalidateProfileQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["contact-profile-entries"] });
    queryClient.invalidateQueries({ queryKey: ["contact-profile-categories"] });
    queryClient.invalidateQueries({ queryKey: ["profile-entries"] });
    queryClient.invalidateQueries({ queryKey: ["profile-categories"] });
  };

  const revertAppliedChange = async (item: ReviewItem) => {
    if (!item.target_entity_id && item.status !== "auto_applied_unreviewed") return;

    if (item.suggestion_type === "normalize_profile_entry") {
      const { data, error } = await supabase.functions.invoke("normalize-profile", {
        body: { action: "rollback", review_id: item.id },
      });
      // A 409 "stale" means the underlying profile already changed — treat
      // as a no-op so bulk Keep/Reject flows don't crash into a blank screen.
      const stale = (data && data.ok === false && data.reason === "stale") || (error as any)?.context?.status === 409;
      if (stale) {
        invalidateProfileQueries();
        return;
      }
      if (error || !data?.ok) {
        throw new Error(error?.message || data?.reason || "Rollback failed");
      }
      invalidateProfileQueries();
      return;
    }


    if (item.suggestion_type === "add_contact" && item.target_entity_id) {
      await supabase.from("contacts").delete().eq("id", item.target_entity_id);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      return;
    }

    if (item.suggestion_type === "add_profile_entry" && item.target_entity_id) {
      await supabase.from("profile_entries").delete().eq("id", item.target_entity_id);
      queryClient.invalidateQueries({ queryKey: ["contact-profile-entries"] });
      return;
    }

    if (item.suggestion_type === "add_relationship" && item.target_entity_id) {
      await supabase.from("contact_relationships").delete().eq("id", item.target_entity_id);
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
      return;
    }

    if (item.suggestion_type === "add_moment" && item.target_entity_id) {
      await supabase.from("moment_participants").delete().eq("moment_id", item.target_entity_id);
      await supabase.from("moments").delete().eq("id", item.target_entity_id);
      queryClient.invalidateQueries({ queryKey: ["moments"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      return;
    }

    if (item.suggestion_type === "add_alias") {
      const { contact_id, alias } = item.payload as any;
      if (!contact_id || !alias) return;
      const { data: contact } = await supabase.from("contacts").select("aliases").eq("id", contact_id).maybeSingle();
      const aliases = Array.isArray(contact?.aliases) ? contact.aliases : [];
      await supabase.from("contacts").update({ aliases: aliases.filter((a: string) => a.toLowerCase() !== String(alias).toLowerCase()) }).eq("id", contact_id);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      return;
    }

    if (item.suggestion_type === "group_member_suggestion") {
      const membershipId = item.target_entity_id;
      if (!membershipId) return;
      await supabase.from("contact_group_memberships").delete().eq("id", membershipId);
      queryClient.invalidateQueries({ queryKey: ["contact_group_memberships"] });
      queryClient.invalidateQueries({ queryKey: ["contact_groups"] });
    }
  };

  const handleAcceptProfileEntry = async (item: ReviewItem) => {
    try {
      const { data, error } = await supabase.functions.invoke("normalize-profile", {
        body: { action: "accept_profile_entry", review_id: item.id },
      });
      if (error || !data?.ok) {
        showToast.error("Failed to add profile entry: " + (error?.message || data?.reason || "Unknown error"));
        refreshReviewQueues();
        return;
      }

      invalidateProfileQueries();
      refreshReviewQueues();
      const outcome = data.outcome === "already_exists" ? "Already in profile" : data.outcome === "merged_list" ? "Merged into profile" : "Added to profile";
      showToast.success(outcome);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAcceptMoment = async (item: ReviewItem) => {
    const p = item.payload as any;
    const title = String(p?.title || "").trim();
    const happenedAt = String(p?.happened_at || "").trim();
    if (!title || !happenedAt) {
      showToast.error("Incomplete moment suggestion");
      return;
    }
    try {
      const participants: Array<{ contact_id?: string | null; is_self?: boolean; name?: string }> = Array.isArray(p.participants) ? p.participants : [];
      const firstContact = participants.find((x) => x.contact_id);
      const { data: inserted, error } = await supabase
        .from("moments")
        .insert({
          user_id: user!.id,
          title,
          description: p.description || null,
          happened_at: happenedAt,
          impact_level: Math.max(1, Math.min(4, Number(p.impact_level) || 2)),
          confidence_date: Math.max(0, Math.min(10, Number(p.confidence_date) || 7)),
          confidence_truth: Math.max(0, Math.min(10, Number(p.confidence_truth) || 7)),
          person_id: firstContact?.contact_id || null,
          source: "note_auto",
          status: "happened",
        } as any)
        .select("id")
        .single();
      if (error || !inserted) {
        showToast.error("Failed to add moment: " + (error?.message || "Unknown error"));
        return;
      }
      const partRows = participants
        .filter((x) => x.contact_id)
        .map((x) => ({ moment_id: inserted.id, person_id: x.contact_id }));
      if (partRows.length > 0) {
        await supabase.from("moment_participants").insert(partRows as any);
      }
      queryClient.invalidateQueries({ queryKey: ["moments"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: {
          target_entity_type: "moment",
          target_entity_id: inserted.id,
          applied_at: new Date().toISOString(),
        },
      });
      showToast.success(`Added moment: ${title}`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAcceptRelationship = async (item: ReviewItem) => {
    const { source_type, source_id, target_type, target_id, label, custom_label, inverse_label, inverse_source_type, inverse_source_id, inverse_target_type, inverse_target_id, contact_name_a, contact_name_b } = item.payload as any;

    try {
      const canonical = canonicalLabel(label) || String(label || "").trim().toLowerCase();
      const aRef: EntityRef = { type: source_type, id: source_id || null };
      const bRef: EntityRef = { type: target_type, id: target_id || null };
      const pairKey = relationshipPairKey(user!.id, aRef, bRef, canonical);

      // Symmetric dedup: check if any existing row (either direction) matches.
      const { data: existingRels } = await supabase
        .from("contact_relationships")
        .select("id, source_type, source_id, target_type, target_id, label")
        .eq("user_id", user!.id);
      const dup = (existingRels || []).find((r: any) => {
        const ra: EntityRef = { type: r.source_type, id: r.source_id };
        const rb: EntityRef = { type: r.target_type, id: r.target_id };
        return relationshipPairKey(user!.id, ra, rb, r.label) === pairKey;
      });

      let insertedId: string | null = dup?.id ?? null;
      if (!dup) {
        const { data: inserted, error } = await supabase
          .from("contact_relationships")
          .insert({
            user_id: user!.id,
            source_type,
            source_id: source_id || null,
            target_type,
            target_id: target_id || null,
            label: canonical,
            custom_label: custom_label || null,
          })
          .select("id")
          .single();

        if (error) {
          if (error.message?.includes("uq_contact_relationship")) {
            showToast.info("This relationship already exists");
            updateStatus.mutate({ id: item.id, status: "kept" });
            return;
          }
          showToast.error("Failed to add relationship: " + error.message);
          return;
        }
        insertedId = inserted?.id ?? null;
      } else {
        showToast.info("This relationship already exists");
      }

      // Only create a mirror suggestion for asymmetric labels.
      if (inverse_label && !isSymmetricLabel(canonical)) {
        const inverseTitle = `Add relationship: ${contact_name_b || "?"} → ${contact_name_a || "?"} (${inverse_label})`;
        await supabase.from("review_queue").insert({
          user_id: user!.id,
          source_note_id: item.source_note_id,
          suggestion_type: "add_relationship",
          title: inverseTitle,
          description: `Mirror relationship: ${contact_name_b} is ${inverse_label} of ${contact_name_a}`,
          payload: {
            source_type: inverse_source_type || target_type,
            source_id: inverse_source_id || target_id,
            target_type: inverse_target_type || source_type,
            target_id: inverse_target_id || source_id,
            label: inverse_label,
            contact_name_a: contact_name_b,
            contact_name_b: contact_name_a,
          },
          status: "pending_review",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: insertedId ? { target_entity_type: "relationship", target_entity_id: insertedId, applied_at: new Date().toISOString() } : undefined,
      });
      showToast.success(`Relationship added: ${contact_name_a} → ${canonical} → ${contact_name_b}`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAcceptNormalize = async (item: ReviewItem) => {
    const payload = item.payload as any;
    try {
      const { data, error } = await supabase.functions.invoke("normalize-profile", {
        body: { action: "apply", review_id: item.id },
      });
      const stale = (data && data.ok === false && data.reason === "stale") || (error as any)?.context?.status === 409;
      if (stale) {
        showToast.info("This profile changed since the suggestion was made — skipping");
        refreshReviewQueues();
        invalidateProfileQueries();
        return;
      }
      if (error || !data?.ok) {
        showToast.error("Could not clean up profile: " + (error?.message || data?.reason || "Unknown error"));
        refreshReviewQueues();
        return;
      }
      invalidateProfileQueries();
      refreshReviewQueues();
      showToast.success(`Cleaned up: ${payload?.canonical_label || "profile entry"}`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
      refreshReviewQueues();
    }
  };

  const handleAccept = async (item: ReviewItem) => {
    const type = item.suggestion_type;

    if (type === "normalize_profile_entry") {
      return handleAcceptNormalize(item);
    }

    if (type === "add_profile_entry") {
      return handleAcceptProfileEntry(item);
    }

    if (type === "add_relationship") {
      return handleAcceptRelationship(item);
    }

    if (type === "add_moment") {
      return handleAcceptMoment(item);
    }

    if (type === "group_member_suggestion") {
      const { group_id, contact_id } = item.payload as any;
      if (!group_id || !contact_id) {
        showToast.error("Incomplete group suggestion");
        return;
      }

      try {
        const { data: existing } = await supabase
          .from("contact_group_memberships")
          .select("id")
          .eq("group_id", group_id)
          .eq("contact_id", contact_id)
          .is("archived_at", null)
          .maybeSingle();

        let membershipId = existing?.id || item.target_entity_id;
        if (!membershipId) {
          const { data, error } = await supabase
            .from("contact_group_memberships")
            .insert({
              user_id: user!.id,
              group_id,
              contact_id,
              status: item.payload?.default_status || null,
              reason: item.description || null,
            })
            .select("id")
            .single();
          if (error || !data) {
            showToast.error("Failed to add to group: " + (error?.message || "Unknown error"));
            return;
          }
          membershipId = data.id;
        }

        queryClient.invalidateQueries({ queryKey: ["contact_group_memberships"] });
        queryClient.invalidateQueries({ queryKey: ["contact_groups"] });
        updateStatus.mutate({ id: item.id, status: "kept", extra: { target_entity_type: "contact_group_membership", target_entity_id: membershipId, applied_at: item.applied_at || new Date().toISOString() } });
        showToast.success("Group member kept");
      } catch (err: any) {
        showToast.error("Error: " + (err.message || "Unknown error"));
      }
      return;
    }

    if (type === "add_alias") {
      const { contact_id, alias } = item.payload as any;
      if (!contact_id || !alias) {
        showToast.error("Missing alias data");
        return;
      }
      // Fetch current aliases, append, update
      const { data: contact, error: fetchErr } = await supabase
        .from("contacts")
        .select("aliases")
        .eq("id", contact_id)
        .single();
      if (fetchErr || !contact) {
        showToast.error("Contact not found");
        return;
      }
      const currentAliases: string[] = Array.isArray(contact.aliases) ? contact.aliases : [];
      if (!currentAliases.some((a: string) => a.toLowerCase() === alias.toLowerCase())) {
        const { error: updateErr } = await supabase
          .from("contacts")
          .update({ aliases: [...currentAliases, alias] })
          .eq("id", contact_id);
        if (updateErr) {
          showToast.error("Failed to add alias: " + updateErr.message);
          return;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      updateStatus.mutate({ id: item.id, status: "kept" });
      showToast.success(`Added "${alias}" as alternate spelling`);
      return;
    }

    if (type === "add_contact") {
      const name = (item.payload.name as string) || "";
      if (!name) {
        showToast.error("No name found in suggestion");
        return;
      }
      const { error } = await supabase.from("contacts").insert({ name });
      if (error) {
        showToast.error("Failed to add contact: " + error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      updateStatus.mutate({ id: item.id, status: "kept" });
      showToast.success(`Added "${name}" to your People`);
      return;
    }

    updateStatus.mutate({ id: item.id, status: "kept" });
    showToast.success("Change kept");
  };

  const handleKeep = async (item: ReviewItem) => {
    // If the suggestion has not actually been applied yet (no target row written),
    // run the real accept path. Status alone is not enough — historical Kept items
    // exist with status="kept" but null target_entity_id because earlier versions
    // of this page only flipped status without inserting.
    const alreadyApplied = !!item.target_entity_id && !!item.applied_at;
    if (!alreadyApplied) return handleAccept(item);
    updateStatus.mutate({ id: item.id, status: "kept" });
    showToast.success("Change kept");
  };

  const handleRemove = async (item: ReviewItem) => {
    try {
      await revertAppliedChange(item);
      updateStatus.mutate({ id: item.id, status: "removed" });
      showToast.info("Change removed");
    } catch (err: any) {
      showToast.error("Could not remove change: " + (err.message || "Unknown error"));
    }
  };

  const handleBlock = async (item: ReviewItem) => {
    try {
      await revertAppliedChange(item);
      await createSuppression(item);
      updateStatus.mutate({ id: item.id, status: "blocked", extra: { blocked_at: new Date().toISOString() } });
      showToast.info("Blocked from future automatic additions");
    } catch (err: any) {
      showToast.error("Could not block change: " + (err.message || "Unknown error"));
    }
  };

  // Batched bulk-action machinery. Prior implementation fired N sequential
  // updateStatus.mutate() calls; each call invalidated the review-queue query,
  // which refetched up to 1000 rows and re-rendered every card — O(N²) DOM
  // churn that froze the browser at ~2k items. We now:
  //   • bulk-flip status for already-applied items in a single UPDATE,
  //   • run pending-item side effects in small concurrent batches,
  //   • refresh queries exactly once at the end.
  const BULK_BATCH = 8;
  const BULK_CONFIRM_THRESHOLD = 100;

  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<null | {
    kind: "keep" | "remove" | "block";
    label: string;
    total: number;
    run: () => Promise<void>;
  }>(null);

  const runInBatches = async <T,>(
    list: T[],
    size: number,
    fn: (item: T) => Promise<void>,
    onDone: () => void,
  ) => {
    for (let i = 0; i < list.length; i += size) {
      const chunk = list.slice(i, i + size);
      await Promise.allSettled(chunk.map((t) => fn(t).finally(onDone)));
    }
  };

  const bulkFlipStatus = async (ids: string[], status: "kept" | "removed" | "blocked") => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, reviewed_at: now };
    if (status === "blocked") patch.blocked_at = now;
    // Chunk the .in() to keep URLs sane.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabase
        .from("review_queue" as any)
        .update(patch as any)
        .in("id", chunk);
      if (error) throw error;
    }
  };

  const runBulk = async (opts: {
    kind: "keep" | "remove" | "block";
    handlePending: (item: ReviewItem) => Promise<void>;
    handleAlreadyAppliedIds: (ids: string[]) => Promise<void>;
    handleWiki: (rev: WikiRevisionReviewItem) => Promise<void>;
    successMessage: (ok: number, fail: number) => string;
  }) => {
    const alreadyAppliedIds: string[] = [];
    const pending: ReviewItem[] = [];
    for (const item of items) {
      if (item.target_entity_id && item.applied_at) alreadyAppliedIds.push(item.id);
      else pending.push(item);
    }
    const profileReviewIds = opts.kind === "keep"
      ? pending.filter((item) => item.suggestion_type === "add_profile_entry").map((item) => item.id)
      : [];
    const pendingIndividual = profileReviewIds.length > 0
      ? pending.filter((item) => item.suggestion_type !== "add_profile_entry")
      : pending;
    const total = alreadyAppliedIds.length + pending.length + wikiRevisions.length;
    if (total === 0) return;

    setIsBulkRunning(true);
    setBulkProgress({ done: 0, total });
    let ok = 0;
    let fail = 0;
    const bump = (success: boolean) => {
      if (success) ok++; else fail++;
      setBulkProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    };

    try {
      // 1) Bulk-flip already-applied items in a single UPDATE.
      try {
        await opts.handleAlreadyAppliedIds(alreadyAppliedIds);
        for (let i = 0; i < alreadyAppliedIds.length; i++) bump(true);
      } catch (err: any) {
        for (let i = 0; i < alreadyAppliedIds.length; i++) bump(false);
        showToast.error(`Bulk update failed: ${err?.message || "Unknown error"}`);
      }

      // 2) Profile-entry approvals run server-side in chunks so thousands of
      // dedup checks/inserts do not execute in the browser.
      for (let i = 0; i < profileReviewIds.length; i += 500) {
        const chunk = profileReviewIds.slice(i, i + 500);
        try {
          const { data, error } = await supabase.functions.invoke("normalize-profile", {
            body: { action: "bulk_profile_reviews", decision: "keep", review_ids: chunk },
          });
          if (error || !data?.ok) throw new Error(error?.message || data?.reason || "Bulk profile review failed");
          const failedCount = Number(data.summary?.failed || 0);
          ok += Math.max(0, chunk.length - failedCount);
          fail += failedCount;
          setBulkProgress((p) => (p ? { ...p, done: p.done + chunk.length } : p));
        } catch (err: any) {
          fail += chunk.length;
          setBulkProgress((p) => (p ? { ...p, done: p.done + chunk.length } : p));
          showToast.error(`Bulk profile cleanup failed: ${err?.message || "Unknown error"}`);
        }
      }

      // 3) Other pending items — small concurrent batches.
      await runInBatches(pendingIndividual, BULK_BATCH, async (item) => {
        try {
          await opts.handlePending(item);
          ok++;
        } catch (err: any) {
          fail++;
          console.warn("Bulk item failed", item.id, err);
        }
      }, () => {
        setBulkProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      });

      // 4) Wiki revisions.
      await runInBatches(wikiRevisions, BULK_BATCH, async (rev) => {
        try {
          await opts.handleWiki(rev);
          ok++;
        } catch (err: any) {
          fail++;
          console.warn("Bulk wiki failed", rev.id, err);
        }
      }, () => {
        setBulkProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      });
    } finally {
      refreshReviewQueues();
      invalidateProfileQueries();
      setIsBulkRunning(false);
      setBulkProgress(null);
    }

    if (fail === 0) showToast.success(opts.successMessage(ok, fail));
    else showToast.info(opts.successMessage(ok, fail));
  };

  const confirmIfLarge = (
    kind: "keep" | "remove" | "block",
    label: string,
    run: () => Promise<void>,
  ) => {
    const total = items.length + wikiRevisions.length;
    if (total >= BULK_CONFIRM_THRESHOLD) {
      setBulkConfirm({ kind, label, total, run });
    } else {
      void run();
    }
  };

  const handleRemoveAll = () => {
    confirmIfLarge("remove", "Roll back", () =>
      runBulk({
        kind: "remove",
        handleAlreadyAppliedIds: async (ids) => {
          // Revert side effects then flip status.
          const byId = new Map(items.map((i) => [i.id, i] as const));
          await runInBatches(ids, BULK_BATCH, async (id) => {
            const item = byId.get(id);
            if (item) await revertAppliedChange(item);
          }, () => {});
          await bulkFlipStatus(ids, "removed");
        },
        handlePending: async (item) => {
          await revertAppliedChange(item);
          await bulkFlipStatus([item.id], "removed");
        },
        handleWiki: async (rev) => {
          await rollbackWikiRevisionById(rev.id);
        },
        successMessage: (ok, fail) =>
          fail === 0 ? "All visible changes removed" : `Removed ${ok}, failed ${fail}`,
      }),
    );
  };

  const handleNeverAgainAll = () => {
    confirmIfLarge("block", "Never Again", () =>
      runBulk({
        kind: "block",
        handleAlreadyAppliedIds: async (ids) => {
          const byId = new Map(items.map((i) => [i.id, i] as const));
          await runInBatches(ids, BULK_BATCH, async (id) => {
            const item = byId.get(id);
            if (!item) return;
            await revertAppliedChange(item);
            await createSuppression(item);
          }, () => {});
          await bulkFlipStatus(ids, "blocked");
        },
        handlePending: async (item) => {
          await revertAppliedChange(item);
          await createSuppression(item);
          await bulkFlipStatus([item.id], "blocked");
        },
        handleWiki: async (rev) => {
          await rollbackWikiRevisionById(rev.id);
        },
        successMessage: (ok, fail) =>
          fail === 0
            ? "All visible changes blocked and rolled back"
            : `Blocked ${ok}, failed ${fail}`,
      }),
    );
  };

  const handleKeepAll = () => {
    confirmIfLarge("keep", "Keep", () =>
      runBulk({
        kind: "keep",
        handleAlreadyAppliedIds: async (ids) => {
          await bulkFlipStatus(ids, "kept");
        },
        handlePending: async (item) => {
          // handleAccept performs the real side-effects (insert profile entry,
          // moment, relationship, alias, etc.) and calls updateStatus.mutate.
          // In bulk mode we accept the per-item invalidation cost because the
          // pending set is typically small; the huge auto-applied set was
          // handled by the fast path above.
          await handleAccept(item);
        },
        handleWiki: async (rev) => {
          await handleWikiLooksGood(rev);
        },
        successMessage: (ok, fail) =>
          fail === 0 ? "All visible changes kept" : `Kept ${ok}, failed ${fail}`,
      }),
    );
  };


  const hasReviewItems = items.length + wikiRevisions.length > 0;
  const combinedReviewItems = useMemo(
    () =>
      [
        ...wikiRevisions.map((revision) => ({ kind: "wiki" as const, created_at: revision.created_at, revision })),
        ...items.map((item) => ({ kind: "review" as const, created_at: item.created_at, item })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [items, wikiRevisions],
  );

  // Paginate to keep the DOM small even with thousands of pending items.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(combinedReviewItems.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);
  const pageItems = useMemo(
    () => combinedReviewItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [combinedReviewItems, page],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold font-display">Review AI Changes</h1>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  const bulkDisabled = updateStatus.isPending || isBulkRunning || !hasReviewItems;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold font-display">Review AI Changes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Menerio automatically added these insights from your notes. Keep what looks right, remove what does not, or block things you never want added again.
        </p>
        {hasReviewItems && (
          <p className="text-xs text-muted-foreground mt-2">
            {combinedReviewItems.length.toLocaleString()} pending {combinedReviewItems.length === 1 ? "change" : "changes"}
            {pageCount > 1 && <> · showing {page * PAGE_SIZE + 1}–{Math.min(combinedReviewItems.length, (page + 1) * PAGE_SIZE)}</>}
          </p>
        )}
      </div>

      {hasReviewItems && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleNeverAgainAll} disabled={bulkDisabled}>
            <X className="h-4 w-4 mr-1" />
            Never Again
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleRemoveAll} disabled={bulkDisabled}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Roll Back
          </Button>
          <Button size="sm" onClick={handleKeepAll} disabled={bulkDisabled}>
            <Check className="h-4 w-4 mr-1" />
            Keep
          </Button>
          {isBulkRunning && bulkProgress && (
            <span className="text-xs text-muted-foreground ml-2">
              Processing {bulkProgress.done.toLocaleString()} / {bulkProgress.total.toLocaleString()}…
            </span>
          )}
        </div>
      )}



      {!hasReviewItems ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              New AI changes will appear here as you add notes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pageItems.map((entry) => {
            if (entry.kind === "wiki") {
              const { revision } = entry;
              const diff = buildLineDiff(revision.previous_content, revision.new_content);
              return (
                <Card key={`wiki-${revision.id}`} className="transition-all hover:shadow-lg">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <BookOpen className="h-5 w-5 mt-0.5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={revision.change_type === "created" ? "default" : "secondary"} className={revision.change_type === "created" ? "text-[10px] bg-success text-success-foreground" : "text-[10px]"}>
                          {revision.change_type}
                        </Badge>
                        <CardTitle className="text-base">
                          <Link to={`/lexicon/${revision.page_slug}`} className="hover:text-primary">
                            {revision.page_title}
                          </Link>
                        </CardTitle>
                        {revision.source_note && (
                          <Link
                            to={`/dashboard/notes/${revision.source_note_id}`}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            via {truncateText(revision.source_note.title, 42)}
                          </Link>
                        )}
                      </div>
                      {revision.change_summary && (
                        <CardDescription className="mt-1">{revision.change_summary}</CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {revision.change_type === "created" ? (
                    <p className="text-sm text-muted-foreground">{truncateText(revision.new_content)}</p>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {diff.removed.length === 0 && diff.added.length === 0 ? (
                        <p className="text-muted-foreground">Updated content</p>
                      ) : (
                        <>
                          {diff.removed.map((line) => <p key={`old-${line}`} className="text-destructive">− {truncateText(line, 160)}</p>)}
                          {diff.added.map((line) => <p key={`new-${line}`} className="text-success">+ {truncateText(line, 160)}</p>)}
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedWikiRevision(revision)}>
                      <Eye className="h-4 w-4 mr-1" />
                      View diff
                    </Button>
                    <div className="flex gap-2">
                      {/* No per-page "Never Again" for Lexicon edits: unlike profile
                          suggestions (which write ai_suggestion_suppressions), the wiki
                          ingest pipeline has no suppression mechanism to honor it yet, so
                          a "Never Again" here would be an empty promise identical to Roll
                          Back. Tracked as a backend follow-up (lock a page from AI edits). */}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRollbackWikiRevision(revision)}>
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Roll Back
                      </Button>
                      <Button size="sm" onClick={() => handleWikiLooksGood(revision)}>
                        <Check className="h-4 w-4 mr-1" />
                        Keep
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            }

            const { item } = entry;
            const config = typeConfig[item.suggestion_type] || typeConfig.link_note;
            const Icon = config.icon;
            const payload = item.payload as any;

            return (
              <Card key={item.id} className="transition-all hover:shadow-lg">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <Icon className={`h-5 w-5 mt-0.5 ${config.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        {item.is_sensitive && <Badge variant="outline" className="text-[10px]">Sensitive</Badge>}
                      </div>
                      {item.description && (
                        <CardDescription className="mt-1">{item.description}</CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {item.suggestion_type === "normalize_profile_entry" && (() => {
                  const before = Array.isArray(payload?.before) ? payload.before : [];
                  const beforeSlugs: string[] = Array.from(new Set(before.map((b: any) => String(b?.category_slug || "")).filter(Boolean)));
                  const movedCategory = payload?.canonical_category_slug && beforeSlugs.length > 0 && !beforeSlugs.includes(payload.canonical_category_slug);
                  return (
                    <CardContent className="space-y-3">
                      <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Merge {before.length} {before.length === 1 ? "entry" : "entries"} → canonical
                        </p>
                        <ul className="space-y-1">
                          {before.map((b: any) => (
                            <li key={b.id} className="text-xs text-muted-foreground/90">
                              <span className="font-medium">{b.label}</span>
                              <span className="opacity-70">: {b.value}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="pt-2 border-t border-border/60">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">
                              {payload?.canonical_label}: <span className="font-normal">{payload?.canonical_value}</span>
                            </span>
                            <Badge variant="secondary" className="text-[10px]">{payload?.canonical_category_slug}</Badge>
                            {movedCategory && (
                              <span className="text-[10px] text-muted-foreground">→ moved to {payload.canonical_category_slug}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {payload?.rationale && (
                        <p className="text-xs text-muted-foreground italic">{payload.rationale}</p>
                      )}
                    </CardContent>
                  );
                })()}
                <CardContent>

                  <div className="flex items-center justify-between">
                    {item.source_note ? (
                      <Link
                        to={`/dashboard/notes/${item.source_note_id}`}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        {item.source_note.title}
                      </Link>
                    ) : typeof item.payload?.source === "string" && item.payload.source.startsWith("moment:") ? (
                      <Link
                        to={`/dashboard/timeline?moment=${String(item.payload.source).slice("moment:".length)}`}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        <Calendar className="h-3 w-3" />
                        From timeline{item.payload?.moment_title ? `: ${String(item.payload.moment_title)}` : ""}
                      </Link>
                    ) : (
                      <span />
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleBlock(item)}
                        disabled={updateStatus.isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Never Again
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(item)}
                        disabled={updateStatus.isPending}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Roll Back
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleKeep(item)}
                        disabled={updateStatus.isPending}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Keep
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || isBulkRunning}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1 || isBulkRunning}
          >
            Next
          </Button>
        </div>
      )}


      <Dialog open={!!selectedWikiRevision} onOpenChange={(open) => !open && setSelectedWikiRevision(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Lexicon revision diff</DialogTitle>
          </DialogHeader>
          {selectedWikiRevision && (
            <div className="grid gap-4 md:grid-cols-2 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Before</p>
                <pre className="whitespace-pre-wrap text-sm font-sans">{selectedWikiRevision.previous_content || ""}</pre>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">After</p>
                <pre className="whitespace-pre-wrap text-sm font-sans">{selectedWikiRevision.new_content}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rollbackWikiRevision} onOpenChange={(open) => !open && setRollbackWikiRevision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back this change?</AlertDialogTitle>
            <AlertDialogDescription>
              The Lexicon page will be restored to its previous content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWikiRollback} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Roll back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!bulkConfirm} onOpenChange={(open) => !open && setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkConfirm?.label} {bulkConfirm?.total.toLocaleString()} changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will process every visible item in the review queue. Large queues can take a while — you'll see a progress indicator while it runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = bulkConfirm;
                setBulkConfirm(null);
                if (c) void c.run();
              }}
            >
              {bulkConfirm?.label} all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

