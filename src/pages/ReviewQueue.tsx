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
import { relationshipWriteDecision } from "@/lib/profile-integrity";
import { useAddClaim } from "@/hooks/useClaims";
import { normalizeAttribute, isReservedAttribute } from "@/lib/claims";
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
  Merge,
  AlertTriangle,
  Globe,
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
  merge_duplicate_person: { icon: Merge, label: "Duplicate person", color: "text-orange-500" },
  resolve_relationship_conflict: { icon: AlertTriangle, label: "Relationship conflict", color: "text-yellow-500" },
  adjudicate_relationship: { icon: Eye, label: "Relationship evidence", color: "text-primary" },
  add_entity: { icon: Globe, label: "Add to World", color: "text-teal-500" },
  add_claim: { icon: Calendar, label: "Dated fact", color: "text-sky-500" },
  unknown_profile_field: { icon: Sparkles, label: "New profile field", color: "text-fuchsia-500" },

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

  const handleAcceptUnknownProfileField = async (item: ReviewItem) => {
    const p = item.payload as any;
    const categorySlug = String(p?.category_slug || "").trim();
    const canonicalLabel = String(p?.canonical_label || p?.label || "").trim();
    const value = String(p?.value || "").trim();
    const categoryId = p?.category_id;
    const contactId = p?.contact_id || null;

    if (!categorySlug || !canonicalLabel || !value || !categoryId) {
      showToast.error("Incomplete profile field suggestion");
      return;
    }

    try {
      // 1. Register the new field so future writes are accepted.
      const { data: field, error: fieldErr } = await supabase
        .from("profile_fields")
        .insert({
          user_id: user!.id,
          category_slug: categorySlug,
          canonical_label: canonicalLabel,
          cardinality: "list",
          value_type: "text",
          aliases: [],
          is_system: false,
          is_active: true,
        })
        .select("id")
        .single();
      if (fieldErr) throw fieldErr;

      // 2. Write the actual profile entry. The canonicalize trigger will now
      //    recognize the label and allow the insert.
      const { data: entry, error: entryErr } = await supabase
        .from("profile_entries")
        .insert({
          user_id: user!.id,
          contact_id: contactId,
          category_id: categoryId,
          label: canonicalLabel,
          value,
          origin: item.source_note_id ? "review_queue" : "user_manual",
          evidence_quote: p?.evidence_quote || null,
          linked_note_id: p?.linked_note_id || item.source_note_id || null,
        })
        .select("id")
        .single();
      if (entryErr) throw entryErr;

      invalidateProfileQueries();
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: {
          target_entity_type: "profile_entry",
          target_entity_id: entry?.id,
          applied_at: new Date().toISOString(),
        },
      });
      showToast.success(`Created field "${canonicalLabel}" and added the value`);
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
      const decision = relationshipWriteDecision({
        userId: user!.id,
        sourceType: source_type,
        sourceId: source_id || null,
        targetType: target_type,
        targetId: target_id || null,
        label: String(label || ""),
      });
      if (decision.ok === false) {
        showToast.info("This relationship was rejected as invalid");
        updateStatus.mutate({ id: item.id, status: "removed" });
        return;
      }
      const canonical = decision.label;
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

      // The person is explicitly confirming this item, so it is exempt from
      // the evidence gate — but when the suggestion carried a source quote we
      // keep it, so the row can always be traced back to a note.
      const confirmedQuote = String((item.payload as any)?.evidence_quote || "").trim();
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
            origin: confirmedQuote.length >= 10 ? "review_queue" : "user_manual",
            evidence_quote: confirmedQuote || null,
            evidence_note_id: (item.payload as any)?.note_id || item.source_note_id || null,
          })
          .select("id")
          .single();

        if (error) {
          if (error.message?.includes("pair_key") || error.message?.includes("uq_contact_relationship")) {
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

      if (insertedId && item.payload?.evidence_id) {
        await supabase
          .from("relationship_evidence" as any)
          .update({ relationship_id: insertedId } as any)
          .eq("id", item.payload.evidence_id)
          .eq("user_id", user!.id);
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
      if (data && data.ok === false && data.reason === "stale") {
        showToast.info("This profile changed since the suggestion was made — skipping");
        refreshReviewQueues();
        invalidateProfileQueries();
        return;
      }
      if (error || !data?.ok) {
        const reason = data?.reason || error?.message || "Unknown error";
        if (data?.resolved) {
          showToast.info(`Suggestion closed — it could not be applied (${reason})`);
        } else {
          showToast.error(`Could not clean up profile — it stays in the queue: ${reason}`);
        }
        refreshReviewQueues();
        invalidateProfileQueries();
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

  // Merge duplicate people: keep one record, fold the others into it via the
  // existing merge-contacts path (notes, facts and relationships move over).
  const handleAcceptMergeDuplicate = async (item: ReviewItem) => {
    const payload = item.payload as any;
    const keepId: string | undefined = payload?.keep_contact_id;
    const mergeIds: string[] = Array.isArray(payload?.merge_contact_ids) ? payload.merge_contact_ids : [];
    if (!keepId || mergeIds.length === 0) {
      showToast.error("Incomplete duplicate suggestion");
      return;
    }
    try {
      for (const sourceId of mergeIds) {
        const { data, error } = await supabase.functions.invoke("merge-contacts", {
          body: { source_contact_id: sourceId, target_contact_id: keepId },
        });
        if (error || (data && data.error)) {
          throw new Error(error?.message || data?.error || "Merge failed");
        }
      }
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      invalidateProfileQueries();
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: { target_entity_type: "contact", target_entity_id: keepId, applied_at: new Date().toISOString() },
      });
      showToast.success(`Merged ${mergeIds.length + 1} records into one`);
    } catch (err: any) {
      showToast.error("Could not merge: " + (err.message || "Unknown error"));
      refreshReviewQueues();
    }
  };

  // Relationship conflict: keep exactly one of the recorded roles for a pair.
  const handleResolveConflict = async (item: ReviewItem, keepRelationshipId: string) => {
    const payload = item.payload as any;
    const options: Array<{ id: string }> = Array.isArray(payload?.options) ? payload.options : [];
    const dropIds = options.map((o) => o.id).filter((id) => id && id !== keepRelationshipId);
    try {
      if (dropIds.length) {
        const { error } = await supabase.from("contact_relationships").delete().in("id", dropIds);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: { target_entity_type: "relationship", target_entity_id: keepRelationshipId, applied_at: new Date().toISOString() },
      });
      showToast.success("Relationship conflict resolved");
    } catch (err: any) {
      showToast.error("Could not resolve conflict: " + (err.message || "Unknown error"));
      refreshReviewQueues();
    }
  };

  const addClaim = useAddClaim();

  const handleAcceptEntity = async (item: ReviewItem) => {
    const p = item.payload as any;
    const name = String(p?.name || "").trim();
    if (!name) {
      showToast.error("Incomplete entity suggestion");
      return;
    }
    try {
      const db = supabase as any;
      const { data: existing } = await db
        .from("entities")
        .select("id")
        .eq("user_id", user!.id)
        .ilike("name", name)
        .maybeSingle();
      let entityId = existing?.id as string | undefined;
      if (!entityId) {
        const { data, error } = await db
          .from("entities")
          .insert({
            user_id: user!.id,
            name,
            entity_type: String(p?.entity_type || "other").toLowerCase(),
            description: p?.description || null,
          })
          .select("id")
          .single();
        if (error || !data) {
          showToast.error("Failed to add to World: " + (error?.message || "Unknown error"));
          return;
        }
        entityId = data.id;
      }
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: { target_entity_type: "entity", target_entity_id: entityId, applied_at: new Date().toISOString() },
      });
      showToast.success("Added to World");
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAcceptClaim = async (item: ReviewItem) => {
    const p = item.payload as any;
    const attribute = normalizeAttribute(String(p?.attribute || ""));
    const value = String(p?.value || "").trim();
    const subjectType = String(p?.subject_type || "") as "self" | "contact" | "entity";
    if (!attribute || !value || !["self", "contact", "entity"].includes(subjectType)) {
      showToast.error("Incomplete fact suggestion");
      return;
    }
    if (isReservedAttribute(attribute)) {
      showToast.error("Relationships are managed in the Relationships section, not as facts");
      return;
    }
    let subjectId: string | null = subjectType === "self" ? null : (p?.subject_id || item.target_entity_id || null);
    if (subjectType !== "self" && !subjectId) {
      showToast.error("This fact has no person or entity to attach to");
      return;
    }
    try {
      const result = await addClaim.mutateAsync({
        subject_type: subjectType,
        subject_id: subjectId,
        attribute,
        value,
        valid_from: p?.valid_from || null,
        confidence: (p?.confidence as any) || "likely",
        source_type: item.source_note_id ? "note" : "manual",
        source_id: item.source_note_id || null,
      });
      updateStatus.mutate({
        id: item.id,
        status: "kept",
        extra: { target_entity_type: "claim", target_entity_id: result.claim.id, applied_at: new Date().toISOString() },
      });
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAccept = async (item: ReviewItem) => {
    const type = item.suggestion_type;

    if (type === "normalize_profile_entry") {
      return handleAcceptNormalize(item);
    }

    if (type === "merge_duplicate_person") {
      return handleAcceptMergeDuplicate(item);
    }

    if (type === "resolve_relationship_conflict") {
      const options: Array<{ id: string; label: string }> = Array.isArray((item.payload as any)?.options)
        ? (item.payload as any).options
        : [];
      if (options.length === 0) {
        showToast.error("Incomplete conflict suggestion");
        return;
      }
      return handleResolveConflict(item, options[0].id);
    }

    if (type === "adjudicate_relationship") {
      updateStatus.mutate({ id: item.id, status: "kept", extra: { applied_at: new Date().toISOString() } });
      return;
    }



    if (type === "add_profile_entry") {
      return handleAcceptProfileEntry(item);
    }

    if (type === "unknown_profile_field") {
      return handleAcceptUnknownProfileField(item);
    }

    if (type === "add_relationship") {
      return handleAcceptRelationship(item);
    }

    if (type === "add_moment") {
      return handleAcceptMoment(item);
    }

    // Nothing produces add_entity / add_claim any more: the 2026-08-11 world
    // extractor was removed from process-note when World became a view. These
    // two branches stay on purpose. Rows created before that removal can still
    // be on screen, and handleAccept's fallthrough would tell the user "Change
    // kept" while writing nothing at all.
    if (type === "add_entity") {
      return handleAcceptEntity(item);
    }

    if (type === "add_claim") {
      return handleAcceptClaim(item);
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

  // Server-side bulk actions. The client fires ONE request; the review-queue-bulk
  // edge function processes every row in the background and writes progress into
  // review_queue_bulk_jobs, which we poll every 2 seconds. No per-item work runs
  // in the browser — that was what froze the tab at 2k+ items.
  const BULK_CONFIRM_THRESHOLD = 100;
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<null | {
    kind: "keep" | "remove" | "block";
    label: string;
    total: number;
    run: () => Promise<void>;
  }>(null);

  const { data: bulkJob } = useQuery({
    queryKey: ["review-queue-bulk-job", bulkJobId],
    enabled: !!bulkJobId,
    refetchInterval: (query) => {
      const j = query.state.data as any;
      if (!j) return 2000;
      return j.status === "running" ? 2000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_queue_bulk_jobs" as any)
        .select("id,status,total,done,failed,last_error,action")
        .eq("id", bulkJobId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!bulkJob || (bulkJob as any).status === "running") return;
    // Job finished: refresh everything once and show a toast.
    refreshReviewQueues();
    invalidateProfileQueries();
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
    queryClient.invalidateQueries({ queryKey: ["contact_group_memberships"] });
    queryClient.invalidateQueries({ queryKey: ["moments"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
    const j = bulkJob as any;
    if (j.status === "error") {
      showToast.error(`Bulk action failed: ${j.last_error || "Unknown error"}`);
    } else {
      const verb = j.action === "keep" ? "kept" : j.action === "rollback" ? "rolled back" : "blocked";
      const okCount = Math.max(0, Number(j.done) || 0);
      const failCount = Math.max(0, Number(j.failed) || 0);
      if (failCount === 0) showToast.success(`${okCount.toLocaleString()} changes ${verb}`);
      else if (okCount === 0)
        showToast.error(`${failCount.toLocaleString()} changes could not be applied and stay in the queue`);
      else
        showToast.error(
          `${okCount.toLocaleString()} changes ${verb} · ${failCount.toLocaleString()} could not be applied and stay in the queue`,
        );

    }
    setBulkJobId(null);
  }, [bulkJob]);

  const invokeBulk = async (action: "keep" | "rollback" | "never_again") => {
    const { data, error } = await supabase.functions.invoke("review-queue-bulk", {
      body: { action, scope: "all" },
    });
    if (error || !data?.job_id) {
      showToast.error("Could not start bulk action: " + (error?.message || "Unknown error"));
      return;
    }
    setBulkJobId(data.job_id);
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

  const handleRemoveAll = () => confirmIfLarge("remove", "Roll back", () => invokeBulk("rollback"));
  const handleNeverAgainAll = () => confirmIfLarge("block", "Never Again", () => invokeBulk("never_again"));
  const handleKeepAll = () => confirmIfLarge("keep", "Keep", () => invokeBulk("keep"));

  const isBulkRunning = !!bulkJobId;



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
          {isBulkRunning && (
            <span className="text-xs text-muted-foreground ml-2">
              {bulkJob && (bulkJob as any).total > 0
                ? `Processing ${Number((bulkJob as any).done).toLocaleString()} / ${Number((bulkJob as any).total).toLocaleString()}…`
                : "Starting…"}
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
                {item.suggestion_type === "unknown_profile_field" && (() => {
                  const p = item.payload as any;
                  return (
                    <CardContent className="space-y-3">
                      <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          New field proposal
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            {p?.canonical_label || p?.label || "Unknown field"}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">{p?.category_slug || "—"}</Badge>
                        </div>
                        <p className="text-sm text-foreground">{p?.value || item.description}</p>
                        <p className="text-xs text-muted-foreground">
                          Keeping this will create the field and add the value to the profile. Roll Back discards the suggestion.
                        </p>
                      </div>
                    </CardContent>
                  );
                })()}
                {item.suggestion_type === "merge_duplicate_person" && (
                  <CardContent className="space-y-2">
                    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">These records will become one</p>
                      <ul className="space-y-1">
                        {(Array.isArray(payload?.contact_ids) ? payload.contact_ids : []).map((id: string) => (
                          <li key={id} className="text-xs">
                            <Link to={`/dashboard/people/${id}`} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                              {payload?.name || "Unnamed"} · {id.slice(0, 8)}
                            </Link>
                            {id === payload?.keep_contact_id && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">kept</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                )}
                {item.suggestion_type === "resolve_relationship_conflict" && (
                  <CardContent className="space-y-2">
                    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Which role is right for {payload?.person_a} & {payload?.person_b}?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(Array.isArray(payload?.options) ? payload.options : []).map((option: any) => (
                          <Button
                            key={option.id}
                            size="sm"
                            variant="outline"
                            onClick={() => handleResolveConflict(item, option.id)}
                            disabled={updateStatus.isPending}
                          >
                            Keep “{option.custom_label || option.label}”
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                )}
                {(item.suggestion_type === "add_relationship" || item.suggestion_type === "adjudicate_relationship") && payload?.evidence_quote && (
                  <CardContent className="space-y-2">
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Source evidence</p>
                      <blockquote className="text-sm text-foreground border-l-2 border-primary pl-3">
                        “{payload.evidence_quote}”
                      </blockquote>
                      {payload?.adjudication_reason && (
                        <p className="text-xs text-muted-foreground">{payload.adjudication_reason}</p>
                      )}
                    </div>
                  </CardContent>
                )}
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

