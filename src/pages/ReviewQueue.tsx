import { useState } from "react";
import { useReviewQueue, type ReviewItem } from "@/hooks/useReviewQueue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateEventDialog, type EventDraft } from "@/components/notes/CreateEventDialog";
import { showToast } from "@/lib/toast";
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
} from "lucide-react";

const typeConfig: Record<string, { icon: typeof CalendarDays; label: string; color: string }> = {
  add_event_temerio: { icon: CalendarDays, label: "Add Event to Temerio", color: "text-blue-500" },
  add_event_cherishly: { icon: Heart, label: "Add Event to Cherishly", color: "text-pink-500" },
  add_contact: { icon: UserPlus, label: "Add to People", color: "text-green-500" },
  link_note: { icon: Link2, label: "Link Note", color: "text-purple-500" },
};

export default function ReviewQueue() {
  const { items, isLoading, updateStatus } = useReviewQueue();
  const navigate = useNavigate();
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const handleAccept = (item: ReviewItem) => {
    const type = item.suggestion_type;

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
      updateStatus.mutate({ id: item.id, status: "accepted" });
      navigate(`/dashboard/people?prefill=${encodeURIComponent(item.payload.name || "")}`);
      return;
    }

    updateStatus.mutate({ id: item.id, status: "accepted" });
    showToast.success("Suggestion accepted");
  };

  const handleDismiss = (id: string) => {
    updateStatus.mutate({ id, status: "dismissed" });
    showToast.info("Suggestion dismissed");
  };

  const handleEventDialogClose = () => {
    // Mark as accepted when dialog closes (user either sent or cancelled)
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
                        onClick={() => handleDismiss(item.id)}
                        disabled={updateStatus.isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Dismiss
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
            if (!open) {
              setEventDialogOpen(false);
              setEventDraft(null);
              setActiveItemId(null);
            }
          }}
          draft={eventDraft}
        />
      )}
    </div>
  );
}
