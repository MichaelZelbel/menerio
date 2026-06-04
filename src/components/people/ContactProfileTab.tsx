import { useEffect, useState } from "react";
import { Plus, Sparkles, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CategorySection } from "@/components/profile/CategorySection";
import { ProfileCompleteness } from "@/components/profile/ProfileCompleteness";
import { SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { CATEGORY_SUGGESTED_LABELS } from "@/lib/profile-suggestions";
import { useContactProfile } from "@/hooks/useContactProfile";
import { PageLoader } from "@/components/LoadingStates";
import { RelationshipsSection } from "@/components/people/RelationshipsSection";
import { LifeEventsStrip } from "@/components/people/LifeEventsStrip";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

interface ContactProfileTabProps {
  contactId: string;
  contactName: string;
}

export function ContactProfileTab({ contactId, contactName }: ContactProfileTabProps) {
  const { user } = useAuth();
  const {
    categories,
    entries,
    isLoading,
    seedDefaults,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
  } = useContactProfile(contactId);

  const [seeded, setSeeded] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("folder");
  const [newCatScope, setNewCatScope] = useState("all");
  const [enriching, setEnriching] = useState(false);

  // Count pending profile suggestions for this contact (from notes OR moments).
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["pending-profile-suggestions", user?.id, contactId],
    enabled: !!user?.id && !!contactId,
    queryFn: async () => {
      const { count } = await supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .in("suggestion_type", ["add_profile_entry", "add_relationship"])
        .in("status", ["pending_review", "pending", "auto_applied_unreviewed"])
        .contains("payload", { contact_id: contactId });
      return count ?? 0;
    },
  });


  const runEnrich = async () => {
    setEnriching(true);
    try {
      const [notes, moments] = await Promise.all([
        supabase.functions.invoke("backfill-profile-extraction", { body: { limit: 200, contact_id: contactId } }),
        supabase.functions.invoke("backfill-moment-profile-extraction", { body: { limit: 200, contact_id: contactId } }),
      ]);
      if (notes.error) throw notes.error;
      if (moments.error) throw moments.error;
      showToast.success("Enrichment started — new facts will appear shortly.");
    } catch (err: any) {
      showToast.error(err.message ?? "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };


  // Auto-seed defaults on first visit
  useEffect(() => {
    if (!isLoading && categories.length === 0 && !seeded) {
      setSeeded(true);
      seedDefaults.mutate();
    }
  }, [isLoading, categories.length, seeded]);

  // Show loader while loading or while seeding is in progress
  if (isLoading || (categories.length === 0 && (seedDefaults.isPending || seeded))) {
    return <PageLoader />;
  }

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const slug = newCatName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    upsertCategory.mutate({
      name: newCatName.trim(),
      slug,
      icon: newCatIcon,
      visibility_scope: newCatScope,
      sort_order: categories.length,
      is_default: false,
    });
    setAddingCategory(false);
    setNewCatName("");
    setNewCatIcon("folder");
    setNewCatScope("all");
  };

  // Find the "neediest" category (fewest entries)
  const neediestId = [...categories]
    .sort((a, b) => {
      const aCount = entries.filter((e) => e.category_id === a.id).length;
      const bCount = entries.filter((e) => e.category_id === b.id).length;
      if (aCount !== bCount) return aCount - bCount;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })[0]?.id;

  return (
    <div className="space-y-3">
      <LifeEventsStrip contactId={contactId} />

      <RelationshipsSection contactId={contactId} contactName={contactName} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Link to={`/dashboard/review-queue?contact_id=${contactId}`}>
              <Badge variant="secondary" className="cursor-pointer">
                {pendingCount} pending profile suggestion{pendingCount === 1 ? "" : "s"}
              </Badge>
            </Link>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={runEnrich} disabled={enriching}>
          {enriching ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
          Enrich from notes & timeline
        </Button>
      </div>


      <ProfileCompleteness categories={categories} entries={entries} />

      {categories.map((cat) => (
        <CategorySection
          key={cat.id}
          category={cat}
          entries={entries.filter((e) => e.category_id === cat.id)}
          defaultExpanded={cat.id === neediestId}
          onSaveEntry={(data) => upsertEntry.mutate(data)}
          onDeleteEntry={(id) => deleteEntry.mutate(id)}
          onUpdateCategory={(data) => upsertCategory.mutate(data)}
          onDeleteCategory={(id) => deleteCategory.mutate(id)}
        />
      ))}

      {addingCategory ? (
        <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              placeholder="Category name"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="Icon (e.g. heart)"
              value={newCatIcon}
              onChange={(e) => setNewCatIcon(e.target.value)}
              className="text-sm"
            />
            <Select value={newCatScope} onValueChange={setNewCatScope}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAddingCategory(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddCategory} disabled={!newCatName.trim()}>Add</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setAddingCategory(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add custom category
        </Button>
      )}
    </div>
  );
}
