import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
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
import { useNavigate, Link } from "react-router-dom";
import {
  UserPlus,
  Link2,
  Check,
  X,
  FileText,
  Inbox,
  User,
  BookOpen,
  Eye,
  RotateCcw,
} from "lucide-react";

const DEFAULT_PROFILE_CATEGORIES = [
  { name: "Identity & Basics", slug: "identity", icon: "user", description: "Full name, pronouns, languages, nationality", sort_order: 0, visibility_scope: "all" },
  { name: "Location & Living", slug: "location", icon: "map-pin", description: "Current city, timezone, living situation", sort_order: 1, visibility_scope: "personal" },
  { name: "Professional Life", slug: "professional", icon: "briefcase", description: "Job, company, industry, skills", sort_order: 2, visibility_scope: "professional" },
  { name: "Education", slug: "education", icon: "graduation-cap", description: "Degrees, certifications, learning style", sort_order: 3, visibility_scope: "professional" },
  { name: "Relationships & Family", slug: "relationships", icon: "heart", description: "Partner, children, close family", sort_order: 4, visibility_scope: "personal" },
  { name: "Communication Style", slug: "communication", icon: "message-circle", description: "Tone, pet peeves, humor style", sort_order: 5, visibility_scope: "all" },
  { name: "Personality & Values", slug: "personality", icon: "compass", description: "Type indicators, core values, philosophy", sort_order: 6, visibility_scope: "all" },
  { name: "Principles & Operating System", slug: "principles", icon: "book-open", description: "Personal rules, codex vitae, frameworks", sort_order: 7, visibility_scope: "all" },
  { name: "Health & Wellness", slug: "health", icon: "activity", description: "Medical, allergies, fitness, sleep", sort_order: 8, visibility_scope: "health" },
  { name: "Hobbies & Interests", slug: "hobbies", icon: "palette", description: "Active hobbies, creative pursuits", sort_order: 9, visibility_scope: "personal" },
  { name: "Food & Drink", slug: "food", icon: "utensils", description: "Cuisines, dietary style, cooking", sort_order: 10, visibility_scope: "personal" },
  { name: "Music & Entertainment", slug: "entertainment", icon: "music", description: "Genres, movies, books, gaming", sort_order: 11, visibility_scope: "personal" },
  { name: "Travel & Experiences", slug: "travel", icon: "plane", description: "Countries, bucket list, travel style", sort_order: 12, visibility_scope: "personal" },
  { name: "Digital Life", slug: "digital", icon: "monitor", description: "Social profiles, tools, tech stack", sort_order: 13, visibility_scope: "all" },
  { name: "Financial", slug: "financial", icon: "wallet", description: "Goals, investment style, budget", sort_order: 14, visibility_scope: "private" },
  { name: "Goals & Aspirations", slug: "goals", icon: "target", description: "Short-term, long-term, anti-goals", sort_order: 15, visibility_scope: "all" },
  { name: "Preferences & Quirks", slug: "preferences", icon: "sliders-horizontal", description: "Morning/night, introvert/extrovert, pet peeves", sort_order: 16, visibility_scope: "all" },
];

const typeConfig: Record<string, { icon: typeof UserPlus; label: string; color: string }> = {
  add_contact: { icon: UserPlus, label: "Add to People", color: "text-green-500" },
  add_alias: { icon: User, label: "Add Alias", color: "text-cyan-500" },
  link_note: { icon: Link2, label: "Link Note", color: "text-purple-500" },
  add_profile_entry: { icon: User, label: "Profile Fact", color: "text-amber-500" },
  add_relationship: { icon: Link2, label: "Relationship", color: "text-indigo-500" },
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
  const navigate = useNavigate();
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
      showToast.error("Could not review wiki update: " + error.message);
      return;
    }
    refreshReviewQueues();
    showToast.success("Wiki update reviewed");
  };

  const handleWikiRollback = async () => {
    if (!rollbackWikiRevision) return;
    const { error } = await supabase.rpc("wiki_rollback_revision" as any, { p_revision_id: rollbackWikiRevision.id });
    if (error) {
      showToast.error("Could not roll back wiki update: " + error.message);
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

  const revertAppliedChange = async (item: ReviewItem) => {
    if (!item.target_entity_id && item.status !== "auto_applied_unreviewed") return;

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

    if (item.suggestion_type === "add_alias") {
      const { contact_id, alias } = item.payload as any;
      if (!contact_id || !alias) return;
      const { data: contact } = await supabase.from("contacts").select("aliases").eq("id", contact_id).maybeSingle();
      const aliases = Array.isArray(contact?.aliases) ? contact.aliases : [];
      await supabase.from("contacts").update({ aliases: aliases.filter((a: string) => a.toLowerCase() !== String(alias).toLowerCase()) }).eq("id", contact_id);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  };

  const handleAcceptProfileEntry = async (item: ReviewItem) => {
    const { contact_id, contact_name, category_slug, label, value } = item.payload as any;
    if (!contact_id || !category_slug || !label || !value) {
      showToast.error("Incomplete profile suggestion");
      return;
    }

    try {
      // Check if the contact has profile categories seeded (scoped to current user)
      const { data: existingCats, error: existingErr } = await supabase
        .from("profile_categories")
        .select("id, slug")
        .eq("user_id", user!.id)
        .eq("contact_id", contact_id);

      if (existingErr) {
        showToast.error("Failed to load contact profile: " + existingErr.message);
        return;
      }

      let categoryId: string | null = null;
      const matchExisting = (existingCats || []).find((c: any) => c.slug === category_slug);
      if (matchExisting) {
        categoryId = matchExisting.id;
      }

      // If no categories exist at all, seed defaults via plain insert.
      // The unique index uses an expression (COALESCE(contact_id, ...)) so we
      // cannot use ON CONFLICT — instead we tolerate 23505 unique-violations
      // (race with another tab) and re-fetch to resolve the category id.
      if (!existingCats || existingCats.length === 0) {
        const rows = DEFAULT_PROFILE_CATEGORIES.map((c) => ({
          ...c,
          user_id: user!.id,
          contact_id,
          is_default: true,
        } as any));
        const { error: seedErr } = await supabase
          .from("profile_categories")
          .insert(rows);
        if (seedErr && (seedErr as any).code !== "23505") {
          showToast.error("Failed to initialize contact profile: " + seedErr.message);
          return;
        }
        // Re-fetch to get the category id (covers both fresh seed and race with another tab)
        const { data: refetched } = await supabase
          .from("profile_categories")
          .select("id, slug")
          .eq("user_id", user!.id)
          .eq("contact_id", contact_id)
          .eq("slug", category_slug)
          .maybeSingle();
        categoryId = refetched?.id || null;
      }

      // Still no category? Create the missing one (custom slug or non-default).
      // Same constraint applies — use select-then-insert with race tolerance.
      if (!categoryId) {
        const { data: existing } = await supabase
          .from("profile_categories")
          .select("id")
          .eq("user_id", user!.id)
          .eq("contact_id", contact_id)
          .eq("slug", category_slug)
          .maybeSingle();
        if (existing?.id) {
          categoryId = existing.id;
        } else {
          const catDef = DEFAULT_PROFILE_CATEGORIES.find((c) => c.slug === category_slug);
          const { data: newCat, error: catErr } = await supabase
            .from("profile_categories")
            .insert({
              name: catDef?.name || category_slug,
              slug: category_slug,
              icon: catDef?.icon || "folder",
              user_id: user!.id,
              contact_id,
              is_default: false,
              sort_order: 99,
              visibility_scope: "all",
            } as any)
            .select("id")
            .maybeSingle();
          if (catErr) {
            if ((catErr as any).code === "23505") {
              // Race: another insert won. Re-select.
              const { data: raced } = await supabase
                .from("profile_categories")
                .select("id")
                .eq("user_id", user!.id)
                .eq("contact_id", contact_id)
                .eq("slug", category_slug)
                .maybeSingle();
              categoryId = raced?.id || null;
            } else {
              showToast.error("Failed to create category: " + catErr.message);
              return;
            }
          } else {
            categoryId = newCat?.id || null;
          }
        }
      }

      if (!categoryId) {
        showToast.error("Could not resolve profile category");
        return;
      }

      // Insert the profile entry
      const { error: entryErr } = await supabase.from("profile_entries").insert({
        category_id: categoryId,
        contact_id,
        label,
        value,
        sort_order: 0,
        user_id: item.user_id,
      });

      if (entryErr) {
        showToast.error("Failed to add profile entry: " + entryErr.message);
        return;
      }

      // Invalidate contact profile queries
      queryClient.invalidateQueries({ queryKey: ["contact-profile-entries"] });
      queryClient.invalidateQueries({ queryKey: ["contact-profile-categories"] });
      updateStatus.mutate({ id: item.id, status: "kept" });
      showToast.success(`Added "${label}: ${value}" to ${contact_name}'s profile`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAcceptRelationship = async (item: ReviewItem) => {
    const { source_type, source_id, target_type, target_id, label, custom_label, inverse_label, inverse_source_type, inverse_source_id, inverse_target_type, inverse_target_id, contact_name_a, contact_name_b } = item.payload as any;

    try {
      // Insert the relationship
      const { data: inserted, error } = await supabase
        .from("contact_relationships")
        .insert({
          user_id: user!.id,
          source_type,
          source_id: source_id || null,
          target_type,
          target_id: target_id || null,
          label,
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

      // Create inverse suggestion in the review queue (suggested mirror)
      if (inverse_label) {
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
            // No inverse_label here — it's the final record, no further mirroring
          },
          status: "pending_review",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
      updateStatus.mutate({ id: item.id, status: "kept" });
      showToast.success(`Relationship added: ${contact_name_a} → ${label} → ${contact_name_b}`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAccept = async (item: ReviewItem) => {
    const type = item.suggestion_type;

    if (type === "add_profile_entry") {
      return handleAcceptProfileEntry(item);
    }

    if (type === "add_relationship") {
      return handleAcceptRelationship(item);
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

  const handleKeep = (item: ReviewItem) => {
    if (item.status === "pending" || item.status === "pending_review") return handleAccept(item);
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

  const handleKeepAll = () => {
    items.forEach((item) => updateStatus.mutate({ id: item.id, status: "kept" }));
    showToast.success("All visible changes kept");
  };

  const handleRemoveAll = async () => {
    for (const item of items) {
      await revertAppliedChange(item);
      updateStatus.mutate({ id: item.id, status: "removed" });
    }
    showToast.info("All visible changes removed");
  };

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

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold font-display">Review AI Changes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Menerio automatically added these insights from your notes. Keep what looks right, remove what does not, or block things you never want added again.
        </p>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleKeepAll} disabled={updateStatus.isPending}>
            <Check className="h-4 w-4 mr-1" />
            Keep all
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleRemoveAll} disabled={updateStatus.isPending}>
            <X className="h-4 w-4 mr-1" />
            Remove all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("/dashboard")}>
            Review later
          </Button>
        </div>
      )}

      {items.length === 0 ? (
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
          {items.map((item) => {
            const config = typeConfig[item.suggestion_type] || typeConfig.link_note;
            const Icon = config.icon;

            return (
              <Card key={item.id} className="transition-all hover:shadow-lg">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <Icon className={`h-5 w-5 mt-0.5 ${config.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        <Badge variant="outline" className="text-[10px]">{config.label}</Badge>
                        <Badge variant={item.status === "auto_applied_unreviewed" ? "default" : "secondary"} className="text-[10px]">
                          {item.status === "auto_applied_unreviewed" ? "Already added" : "Needs approval"}
                        </Badge>
                        {item.is_sensitive && <Badge variant="outline" className="text-[10px]">Sensitive</Badge>}
                      </div>
                      {item.description && (
                        <CardDescription className="mt-1">{item.description}</CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
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
                        Never add again
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(item)}
                        disabled={updateStatus.isPending}
                      >
                        Remove
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

    </div>
  );
}
