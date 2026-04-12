import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReviewQueue, type ReviewItem } from "@/hooks/useReviewQueue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateEventDialog, type EventDraft } from "@/components/notes/CreateEventDialog";
import { showToast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Link } from "react-router-dom";
import {
  CalendarDays,
  Heart,
  UserPlus,
  Link2,
  Check,
  X,
  FileText,
  Inbox,
  User,
} from "lucide-react";

const DEFAULT_PROFILE_CATEGORIES = [
  { name: "Identity & Basics", slug: "identity", icon: "user", description: "Full name, pronouns, languages, nationality", sort_order: 0, visibility_scope: "all" },
  { name: "Location & Living", slug: "location", icon: "map-pin", description: "Current city, timezone, living situation", sort_order: 1, visibility_scope: "personal" },
  { name: "Professional Life", slug: "professional", icon: "briefcase", description: "Job, company, industry, skills", sort_order: 2, visibility_scope: "professional" },
  { name: "Relationships & Family", slug: "relationships", icon: "heart", description: "Close people, shared connections", sort_order: 3, visibility_scope: "personal" },
  { name: "Communication Style", slug: "communication", icon: "message-circle", description: "Tone, preferences, humor style", sort_order: 4, visibility_scope: "all" },
  { name: "Personality & Values", slug: "personality", icon: "compass", description: "Core values, character traits", sort_order: 5, visibility_scope: "all" },
  { name: "Hobbies & Interests", slug: "hobbies", icon: "palette", description: "Active hobbies, creative pursuits", sort_order: 6, visibility_scope: "personal" },
  { name: "Food & Drink", slug: "food", icon: "utensils", description: "Cuisines, dietary style", sort_order: 7, visibility_scope: "personal" },
  { name: "Travel & Experiences", slug: "travel", icon: "plane", description: "Countries, travel style", sort_order: 8, visibility_scope: "personal" },
  { name: "Preferences & Quirks", slug: "preferences", icon: "sliders-horizontal", description: "Likes, dislikes, pet peeves", sort_order: 9, visibility_scope: "all" },
];

const typeConfig: Record<string, { icon: typeof CalendarDays; label: string; color: string }> = {
  add_event_temerio: { icon: CalendarDays, label: "Add Event to Temerio", color: "text-blue-500" },
  add_event_cherishly: { icon: Heart, label: "Add Event to Cherishly", color: "text-pink-500" },
  add_contact: { icon: UserPlus, label: "Add to People", color: "text-green-500" },
  link_note: { icon: Link2, label: "Link Note", color: "text-purple-500" },
  add_profile_entry: { icon: User, label: "Profile Fact", color: "text-amber-500" },
};

export default function ReviewQueue() {
  const { items, isLoading, updateStatus } = useReviewQueue();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const handleAcceptProfileEntry = async (item: ReviewItem) => {
    const { contact_id, contact_name, category_slug, label, value } = item.payload as any;
    if (!contact_id || !category_slug || !label || !value) {
      showToast.error("Incomplete profile suggestion");
      return;
    }

    try {
      // Check if the contact has profile categories seeded
      const { data: existingCats } = await supabase
        .from("profile_categories")
        .select("id, slug")
        .eq("contact_id", contact_id);

      let categoryId: string | null = null;

      if (!existingCats || existingCats.length === 0) {
        // Seed default categories for this contact
        const rows = DEFAULT_PROFILE_CATEGORIES.map((c) => ({
          ...c,
          contact_id,
          is_default: true,
        } as any));
        const { data: seeded, error: seedErr } = await supabase
          .from("profile_categories")
          .insert(rows)
          .select("id, slug");
        if (seedErr) {
          showToast.error("Failed to initialize contact profile: " + seedErr.message);
          return;
        }
        const match = (seeded || []).find((c: any) => c.slug === category_slug);
        categoryId = match?.id || null;
      } else {
        const match = existingCats.find((c: any) => c.slug === category_slug);
        categoryId = match?.id || null;
      }

      if (!categoryId) {
        // Category slug doesn't exist — create it
        const catDef = DEFAULT_PROFILE_CATEGORIES.find((c) => c.slug === category_slug);
        const { data: newCat, error: catErr } = await supabase
          .from("profile_categories")
          .insert({
            name: catDef?.name || category_slug,
            slug: category_slug,
            icon: catDef?.icon || "folder",
            contact_id,
            is_default: false,
            sort_order: 99,
            visibility_scope: "all",
          } as any)
          .select("id")
          .single();
        if (catErr) {
          showToast.error("Failed to create category: " + catErr.message);
          return;
        }
        categoryId = newCat.id;
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
      updateStatus.mutate({ id: item.id, status: "accepted" });
      showToast.success(`Added "${label}: ${value}" to ${contact_name}'s profile`);
    } catch (err: any) {
      showToast.error("Error: " + (err.message || "Unknown error"));
    }
  };

  const handleAccept = async (item: ReviewItem) => {
    const type = item.suggestion_type;

    if (type === "add_profile_entry") {
      return handleAcceptProfileEntry(item);
    }

    if (type === "add_event_temerio" || type === "add_event_cherishly") {
      const draft: EventDraft = {
        headline: item.payload.headline || item.title,
        description: item.payload.description || "",
        happened_at: item.payload.happened_at || new Date().toISOString().slice(0, 16),
        status: "past_fact",
        participants: item.payload.people_names || [],
      };
      setEventDraft(draft);
      setActiveItemId(item.id);
      setEventDialogOpen(true);
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
      updateStatus.mutate({ id: item.id, status: "accepted" });
      showToast.success(`Added "${name}" to your People`);
      return;
    }

    updateStatus.mutate({ id: item.id, status: "accepted" });
    showToast.success("Suggestion accepted");
  };

  const handleSkip = (id: string) => {
    updateStatus.mutate({ id, status: "skipped" });
    showToast.info("Skipped for now");
  };

  const handleNever = (id: string) => {
    updateStatus.mutate({ id, status: "dismissed" });
    showToast.info("Won't suggest again");
  };

  const handleEventDialogClose = () => {
    if (activeItemId) {
      updateStatus.mutate({ id: activeItemId, status: "accepted" });
    }
    setEventDialogOpen(false);
    setEventDraft(null);
    setActiveItemId(null);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold font-display">Review Queue</h1>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold font-display">Review Queue</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI-generated suggestions from your notes. Review, accept, or dismiss.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              New suggestions will appear here as you add notes.
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
                        onClick={() => handleNever(item.id)}
                        disabled={updateStatus.isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Never
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSkip(item.id)}
                        disabled={updateStatus.isPending}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleAccept(item)}
                        disabled={updateStatus.isPending}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Accept
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {eventDraft && (
        <CreateEventDialog
          open={eventDialogOpen}
          onOpenChange={(open) => {
            if (!open) handleEventDialogClose();
          }}
          draft={eventDraft}
        />
      )}
    </div>
  );
}
