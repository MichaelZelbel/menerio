import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { Loader2 } from "lucide-react";

export interface EventDraft {
  headline: string;
  description?: string;
  happened_at: string;
  happened_end?: string | null;
  status: string;
  impact_level?: number;
  confidence_date?: number;
  confidence_truth?: number;
  participants?: string[];
}

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: EventDraft | null;
}

const STATUS_OPTIONS = [
  { value: "past_fact", label: "Past Fact" },
  { value: "future_plan", label: "Future Plan" },
  { value: "ongoing", label: "Ongoing" },
  { value: "unknown", label: "Unknown" },
];

export function CreateEventDialog({
  open,
  onOpenChange,
  draft,
}: CreateEventDialogProps) {
  const [headline, setHeadline] = useState(draft?.headline || "");
  const [description, setDescription] = useState(draft?.description || "");
  const [happenedAt, setHappenedAt] = useState(draft?.happened_at || "");
  const [happenedEnd, setHappenedEnd] = useState(draft?.happened_end || "");
  const [status, setStatus] = useState(draft?.status || "past_fact");
  const [impactLevel, setImpactLevel] = useState(draft?.impact_level || 2);
  const [confidenceDate, setConfidenceDate] = useState(draft?.confidence_date ?? 7);
  const [confidenceTruth, setConfidenceTruth] = useState(draft?.confidence_truth ?? 8);
  const [isSending, setIsSending] = useState(false);

  // Reset fields when draft changes
  const resetFromDraft = (d: EventDraft) => {
    setHeadline(d.headline || "");
    setDescription(d.description || "");
    setHappenedAt(d.happened_at || "");
    setHappenedEnd(d.happened_end || "");
    setStatus(d.status || "past_fact");
    setImpactLevel(d.impact_level || 2);
    setConfidenceDate(d.confidence_date ?? 7);
    setConfidenceTruth(d.confidence_truth ?? 8);
  };

  // Sync when dialog opens with new draft
  useState(() => {
    if (draft) resetFromDraft(draft);
  });

  const handleSubmit = async () => {
    if (!headline.trim() || !happenedAt) {
      showToast.error("Headline and start date are required");
      return;
    }

    setIsSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData?.session?.user?.email;
      if (!email) {
        showToast.error("Could not determine your email for Temerio lookup");
        return;
      }

      const payload = {
        email,
        headline: headline.trim(),
        description: description.trim() || null,
        happened_at: happenedAt,
        happened_end: happenedEnd || null,
        status,
        impact_level: impactLevel,
        confidence_date: confidenceDate,
        confidence_truth: confidenceTruth,
      };

      const { data, error } = await supabase.functions.invoke("send-to-temerio", {
        body: payload,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      showToast.success("Event created in Temerio!");
      onOpenChange(false);
    } catch (err: any) {
      console.error("Send to Temerio failed:", err);
      showToast.error(err.message || "Failed to create event in Temerio");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Event in Temerio</DialogTitle>
          <DialogDescription>
            Review and edit the extracted event details, then send to your Temerio timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Headline */}
          <div className="space-y-1.5">
            <Label htmlFor="event-headline">Headline *</Label>
            <Input
              id="event-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Event title"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-start">Start Date *</Label>
              <Input
                id="event-start"
                type="date"
                value={happenedAt}
                onChange={(e) => setHappenedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-end">End Date</Label>
              <Input
                id="event-end"
                type="date"
                value={happenedEnd}
                onChange={(e) => setHappenedEnd(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="event-desc">Description</Label>
            <Textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context…"
              rows={3}
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Impact Level */}
          <div className="space-y-1.5">
            <Label>Impact Level: {impactLevel}</Label>
            <Slider
              value={[impactLevel]}
              onValueChange={([v]) => setImpactLevel(v)}
              min={1}
              max={4}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Minor</span>
              <span>Major</span>
            </div>
          </div>

          {/* Confidence Date */}
          <div className="space-y-1.5">
            <Label>Date Confidence: {confidenceDate}/10</Label>
            <Slider
              value={[confidenceDate]}
              onValueChange={([v]) => setConfidenceDate(v)}
              min={0}
              max={10}
              step={1}
            />
          </div>

          {/* Confidence Truth */}
          <div className="space-y-1.5">
            <Label>Truth Confidence: {confidenceTruth}/10</Label>
            <Slider
              value={[confidenceTruth]}
              onValueChange={([v]) => setConfidenceTruth(v)}
              min={0}
              max={10}
              step={1}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSending}>
            {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create in Temerio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
