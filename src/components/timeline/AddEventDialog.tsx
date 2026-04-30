import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAICreditsGate } from "@/hooks/useAICreditsGate";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import PeopleMultiSelect from "./PeopleMultiSelect";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import ImportanceSlider from "./ImportanceSlider";

export interface TimelineContact {
  id: string;
  name: string;
  relationship: string | null;
}

interface MomentDraft {
  happened_at: string;
  happened_end?: string | null;
  title: string;
  status: string;
  impact_level: number;
  confidence_date: number;
  confidence_truth: number;
  participants?: string[];
}

export interface EditMomentData {
  id: string;
  title: string;
  description: string | null;
  happened_at: string;
  happened_end: string | null;
  status: string;
  impact_level: number;
  confidence_date: number;
  confidence_truth: number;
  participantIds?: string[];
}

interface AddEventDialogProps {
  people: TimelineContact[];
  onCreated: () => void;
  editEvent?: EditMomentData | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function AddEventDialog({ people, onCreated, editEvent, open: controlledOpen, onOpenChange }: AddEventDialogProps) {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const { checkCredits } = useAICreditsGate();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange || (() => {})) : setInternalOpen;
  const isEditMode = !!editEvent;
  const today = format(new Date(), "yyyy-MM-dd");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateStart, setDateStart] = useState(today);
  const [dateEnd, setDateEnd] = useState("");
  const [status, setStatus] = useState("unknown");
  const [impactLevel, setImpactLevel] = useState(2);
  const [confDate, setConfDate] = useState(5);
  const [confTruth, setConfTruth] = useState(5);
  const [matchedPeople, setMatchedPeople] = useState<string[]>([]);
  const [suggestedNewPeople, setSuggestedNewPeople] = useState<string[]>([]);
  const [selectedNewPeople, setSelectedNewPeople] = useState<string[]>([]);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editEvent) {
      setTitle(editEvent.title);
      setDescription(editEvent.description || "");
      setDateStart(editEvent.happened_at.split("T")[0]);
      setDateEnd(editEvent.happened_end ? editEvent.happened_end.split("T")[0] : "");
      setStatus(editEvent.status);
      setImpactLevel(editEvent.impact_level);
      setConfDate(editEvent.confidence_date);
      setConfTruth(editEvent.confidence_truth);
      setMatchedPeople(editEvent.participantIds || []);
    } else {
      setTitle("");
      setDescription("");
      setDateStart(today);
      setDateEnd("");
      setStatus("unknown");
      setImpactLevel(2);
      setConfDate(5);
      setConfTruth(5);
      setMatchedPeople([]);
    }
    setSuggestedNewPeople([]);
    setSelectedNewPeople([]);
    setSuggestionApplied(false);
  }, [open, editEvent, today]);

  const applyDraft = (draft: MomentDraft) => {
    setTitle(draft.title || title);
    setDateStart(draft.happened_at || dateStart);
    setDateEnd(draft.happened_end || "");
    setStatus(["past_fact", "future_plan", "ongoing", "unknown"].includes(draft.status) ? draft.status : "unknown");
    setImpactLevel(clamp(Number(draft.impact_level) || 2, 1, 4));
    setConfDate(clamp(Number(draft.confidence_date) || 5, 0, 10));
    setConfTruth(clamp(Number(draft.confidence_truth) || 5, 0, 10));

    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const name of draft.participants || []) {
      const found = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (found) matched.push(found.id);
      else unmatched.push(name);
    }
    setMatchedPeople((prev) => Array.from(new Set([...prev, ...matched])));
    setSuggestedNewPeople(Array.from(new Set(unmatched)));
    setSelectedNewPeople(Array.from(new Set(unmatched)));
    setSuggestionApplied(true);
  };

  const handleAiSuggest = async () => {
    if (!description.trim() || !session) return;
    if (!checkCredits()) return;
    setAiLoading(true);
    setSuggestionApplied(false);
    try {
      const { data, error } = await supabase.functions.invoke("draft-event", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { messages: [{ role: "user", content: description.trim() }], today, people: people.map((p) => ({ name: p.name })) },
      });
      if (error) {
        if (error.message?.includes("402")) {
          toast({ title: "Out of AI credits", variant: "destructive" });
          return;
        }
        throw error;
      }
      if ((data as any)?.code === "INSUFFICIENT_CREDITS") {
        toast({ title: "Out of AI credits", variant: "destructive" });
        return;
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      applyDraft((data as any).draft as MomentDraft);
      triggerCreditsRefresh();
    } catch (err: any) {
      toast({ title: "AI error", description: err?.message || "AI request failed", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || !title.trim() || !dateStart) return;
    setSaving(true);
    try {
      const momentPayload = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        happened_at: dateStart,
        happened_end: dateEnd || null,
        status,
        impact_level: impactLevel,
        confidence_date: confDate,
        confidence_truth: confTruth,
        person_id: matchedPeople[0] || null,
      };

      let momentId = editEvent?.id;
      if (isEditMode && momentId) {
        const { error } = await supabase.from("moments" as any).update(momentPayload).eq("id", momentId);
        if (error) throw error;
        await supabase.from("moment_participants" as any).delete().eq("moment_id", momentId);
      } else {
        const { data, error } = await supabase.from("moments" as any).insert({ ...momentPayload, source: "manual" }).select("id").single();
        if (error || !data) throw error || new Error("Moment was not created");
        momentId = (data as any).id;
      }

      const newPeopleIds: string[] = [];
      for (const name of selectedNewPeople) {
        const { data } = await supabase.from("contacts").insert({ user_id: user.id, name }).select("id").single();
        if (data) newPeopleIds.push(data.id);
      }

      const participantIds = Array.from(new Set([...matchedPeople, ...newPeopleIds]));
      if (participantIds.length > 0 && momentId) {
        const { error } = await supabase.from("moment_participants" as any).insert(participantIds.map((person_id) => ({ moment_id: momentId, person_id })));
        if (error) throw error;
      }

      toast({ title: isEditMode ? "Moment updated" : "Moment created" });
      setOpen(false);
      onCreated();
    } catch (err: any) {
      toast({ title: isEditMode ? "Failed to update moment" : "Failed to create moment", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const dialogContent = (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{isEditMode ? "Edit Moment" : "Add Moment"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <Textarea value={description} onChange={(e) => { setDescription(e.target.value); if (suggestionApplied) setSuggestionApplied(false); }} placeholder="Describe what happened…" rows={4} />
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="sm" onClick={handleAiSuggest} disabled={aiLoading || !description.trim()} className="w-full">
            {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Suggest title and other values
          </Button>
          {suggestionApplied && <p className="text-xs text-muted-foreground">Suggestions applied — review and edit below.</p>}
        </div>
        <div className="space-y-2"><Label>Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title for this moment" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Start Date *</Label><Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} /></div>
          <div className="space-y-2"><Label>End Date</Label><Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="past_fact">Past Fact</SelectItem><SelectItem value="future_plan">Future Plan</SelectItem><SelectItem value="ongoing">Ongoing</SelectItem><SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Confidence (Date): {confDate}</Label><Slider value={[confDate]} onValueChange={([v]) => setConfDate(v)} min={0} max={10} step={1} /></div>
        </div>
        <ImportanceSlider value={impactLevel} onChange={setImpactLevel} />
        <div className="space-y-2"><Label>Confidence (Truth): {confTruth}</Label><Slider value={[confTruth]} onValueChange={([v]) => setConfTruth(v)} min={0} max={10} step={1} /></div>
        {people.length > 0 && <div className="space-y-2"><Label className="text-xs">People</Label><PeopleMultiSelect people={people} value={matchedPeople} onChange={setMatchedPeople} /></div>}
        {suggestedNewPeople.length > 0 && <div className="space-y-2"><Label className="text-xs text-muted-foreground">Add new people (not yet in your list)</Label><div className="space-y-1.5">{suggestedNewPeople.map((name) => <label key={name} className="flex items-center gap-2 cursor-pointer"><Checkbox checked={selectedNewPeople.includes(name)} onCheckedChange={(checked) => setSelectedNewPeople((prev) => checked ? [...prev, name] : prev.filter((n) => n !== name))} /><span className="text-sm">{name}</span></label>)}</div></div>}
      </div>
      <DialogFooter><Button onClick={handleSave} disabled={saving || !title.trim() || !dateStart}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isEditMode ? "Save Changes" : "Create Moment"}</Button></DialogFooter>
    </DialogContent>
  );

  if (isControlled) return <Dialog open={open} onOpenChange={setOpen}>{dialogContent}</Dialog>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Moment</Button></DialogTrigger>{dialogContent}</Dialog>;
}
