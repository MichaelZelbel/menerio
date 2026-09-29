import { useMemo, useState } from "react";
import { FileText, Sparkles, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileSections } from "@/components/profile/ProfileSections";
import { QuickAddFact } from "@/components/people/profile/QuickAddFact";
import { ProfileCompleteness } from "@/components/profile/ProfileCompleteness";
import { PROFILE_TAXONOMY } from "@/lib/profile-taxonomy";
import { useContactProfile } from "@/hooks/useContactProfile";
import { useFacts, type FactSubject } from "@/hooks/useFacts";
import { PageLoader } from "@/components/LoadingStates";
import { RelationshipsSection } from "@/components/people/RelationshipsSection";
import { LifeEventsStrip } from "@/components/people/LifeEventsStrip";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

interface ContactProfileTabProps {
  contactId: string;
  contactName: string;
  notes?: string;
  isEditingNotes?: boolean;
  onChangeNotes?: (value: string) => void;
  relatedNotes?: Array<{ id: string; title: string | null }>;
}

// Shown in the relationships card, not in the facts list, so never a move target.
const RELATIONSHIP_SLUGS = ["relationships"];

export function ContactProfileTab({
  contactId,
  contactName,
  notes,
  isEditingNotes = false,
  onChangeNotes,
  relatedNotes = [],
}: ContactProfileTabProps) {
  const { user } = useAuth();
  const { categories, isLoading: sectionsLoading, upsertCategory, deleteCategory } = useContactProfile(contactId);
  const subject = useMemo<FactSubject>(() => ({ type: "contact", id: contactId }), [contactId]);
  const { facts, isLoading: factsLoading, actions, addFact } = useFacts(subject);
  const isLoading = sectionsLoading || factsLoading;

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
      const [notes, moments, lexicon] = await Promise.all([
        supabase.functions.invoke("backfill-profile-extraction", { body: { limit: 200, contact_id: contactId } }),
        supabase.functions.invoke("backfill-moment-profile-extraction", { body: { limit: 200, contact_id: contactId } }),
        supabase.functions.invoke("enrich-person-from-lexicon", { body: { contact_id: contactId } }),
      ]);
      if (notes.error) throw notes.error;
      if (moments.error) throw moments.error;
      if (lexicon.error) throw lexicon.error;
      showToast.success("Enrichment started. New facts will appear shortly.");
    } catch (err: any) {
      showToast.error(err.message ?? "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  if (isLoading) {
    return <PageLoader />;
  }

  // Relationship-adjacent facts (Wedding date, Anniversary, How we met…) are
  // rendered INSIDE the Relationships card, so a profile has exactly one
  // relationship surface. They are removed from the facts panel here.
  const isRelationshipSection = (slug: string | null) => slug === RELATIONSHIP_SLUGS[0];
  const factCategories = categories.filter((c) => !isRelationshipSection(c.slug));
  const sectionFacts = facts.filter((f) => !isRelationshipSection(f.category_slug));
  const milestones = facts
    .filter((f) => f.is_current && isRelationshipSection(f.category_slug))
    .map((f) => ({ id: f.claim_id, label: f.label, value: f.value }));

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          {isEditingNotes ? (
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes ?? ""}
                onChange={(e) => onChangeNotes?.(e.target.value)}
                placeholder="Add private notes about this person..."
                className="min-h-24"
              />
            </div>
          ) : notes ? (
            <p className="text-sm whitespace-pre-wrap">{notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
        </CardContent>
      </Card>

      <RelationshipsSection contactId={contactId} contactName={contactName} milestones={milestones} />

      <ProfileSections
        categories={factCategories}
        facts={sectionFacts}
        actions={actions}
        excludeSlugs={RELATIONSHIP_SLUGS}
        showScope
        onUpdateCategory={(data) => upsertCategory.mutate(data)}
        onDeleteCategory={(id) => deleteCategory.mutate(id)}
        onAddCategory={(data) => upsertCategory.mutate(data)}
      >
        {user?.id && (
          <QuickAddFact
            contactId={contactId}
            onCommit={async ({ category_slug, label, value }) => {
              await addFact.mutateAsync({ category_slug, label, value });
            }}
          />
        )}
      </ProfileSections>

      <LifeEventsStrip contactId={contactId} />



      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Related Notes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Automatically derived from notes that mention this person. Open a note to add or remove the mention.
          </p>
        </CardHeader>
        <CardContent>
          {relatedNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No related notes found.</p>
          ) : (
            <div className="space-y-2">
              {relatedNotes.map((note) => (
                <Link key={note.id} to={`/dashboard/notes/${note.id}`} className="block rounded-md border p-3 hover:bg-accent">
                  <p className="text-sm font-medium">{note.title || "Untitled"}</p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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

      <ProfileCompleteness categories={categories} facts={facts} totalSlots={PROFILE_TAXONOMY.length} />
    </div>
  );
}
