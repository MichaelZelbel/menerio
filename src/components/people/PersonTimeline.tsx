import { useCallback, useEffect, useState } from "react";
import { Calendar, MessageSquare, Pencil, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import AddEventDialog, { type EditMomentData, type TimelineContact } from "@/components/timeline/AddEventDialog";

interface MomentEntry {
  id: string;
  title: string;
  description: string | null;
  happened_at: string;
  happened_end: string | null;
  status: string;
  impact_level: number;
  confidence_date: number;
  confidence_truth: number;
  participantIds: string[];
}

interface PersonTimelineProps {
  personId: string;
  personName: string;
  people: TimelineContact[];
  onAskMira: (context: string) => void;
}

export function PersonTimeline({ personId, personName, people, onAskMira }: PersonTimelineProps) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState("detailed");
  const [entries, setEntries] = useState<MomentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EditMomentData | null>(null);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    const { data: participantRows, error: participantError } = await supabase
      .from("moment_participants" as any)
      .select("moment_id")
      .eq("person_id", personId);
    if (participantError) {
      toast({ variant: "destructive", title: "Failed to load timeline", description: participantError.message });
      setLoading(false);
      return;
    }

    const participantMomentIds = (participantRows || []).map((row: any) => row.moment_id);
    let query = supabase
      .from("moments" as any)
      .select("id, title, description, happened_at, happened_end, status, impact_level, confidence_date, confidence_truth, person_id")
      .is("deleted_at", null)
      .order("happened_at", { ascending: false });

    if (participantMomentIds.length > 0) query = query.or(`person_id.eq.${personId},id.in.(${participantMomentIds.join(",")})`);
    else query = query.eq("person_id", personId);

    const { data, error } = await query;
    if (error) toast({ variant: "destructive", title: "Failed to load timeline", description: error.message });
    const momentIds = (data || []).map((m: any) => m.id);
    const participantMap = new Map<string, string[]>();
    if (momentIds.length > 0) {
      const { data: allParticipants } = await supabase.from("moment_participants" as any).select("moment_id, person_id").in("moment_id", momentIds);
      for (const row of allParticipants || []) {
        participantMap.set((row as any).moment_id, [...(participantMap.get((row as any).moment_id) || []), (row as any).person_id]);
      }
    }
    setEntries((data || []).map((m: any) => ({ ...m, participantIds: Array.from(new Set([...(participantMap.get(m.id) || []), m.person_id].filter(Boolean))) })));
    setLoading(false);
  }, [personId, toast]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  const deleteMoment = async (entry: MomentEntry) => {
    if (!confirm(`Delete "${entry.title}"?`)) return;
    // Soft delete: this table's own read filters on deleted_at IS NULL, so a
    // hard delete threw away recoverable history (and cascaded the moment's
    // participants and provenance) for no reason. Setting deleted_at hides it
    // the same way while leaving the row intact.
    const { error } = await supabase.from("moments" as any).update({ deleted_at: new Date().toISOString() }).eq("id", entry.id);
    if (error) return toast({ variant: "destructive", title: "Failed to delete", description: error.message });
    toast({ title: "Deleted" });
    loadTimeline();
  };

  const formatDate = (value: string) => format(new Date(value), "MMMM d, yyyy");
  const filteredEntries = viewMode === "milestones" ? entries.filter((entry) => entry.impact_level >= 3) : entries;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-5 w-5 text-primary" />{filteredEntries.length} moments with {personName}</div>
        <Button size="sm" variant="outline" onClick={() => { setEditingEntry(null); setDialogOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add Moment</Button>
      </div>

      <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value)} className="w-fit rounded-lg bg-muted/50 p-1">
        <ToggleGroupItem value="milestones" className="px-3 text-xs"><Star className="mr-1.5 h-3.5 w-3.5" />Milestones</ToggleGroupItem>
        <ToggleGroupItem value="detailed" className="px-3 text-xs"><Calendar className="mr-1.5 h-3.5 w-3.5" />Detailed</ToggleGroupItem>
        <ToggleGroupItem value="ai-summary" className="px-3 text-xs"><Sparkles className="mr-1.5 h-3.5 w-3.5" />AI Summary</ToggleGroupItem>
      </ToggleGroup>

      {viewMode === "ai-summary" && <Card className="border-dashed"><CardContent className="py-8 text-center"><Sparkles className="mx-auto mb-3 h-10 w-10 text-primary/50" /><h3 className="mb-2 text-lg font-medium">AI-Powered Story Summary</h3><p className="mx-auto max-w-md text-sm text-muted-foreground">Coming soon: a concise narrative of your timeline with {personName}, highlighting the moments that matter most.</p></CardContent></Card>}

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading timeline…</div>}
      {!loading && viewMode !== "ai-summary" && filteredEntries.length === 0 && <Card className="border-dashed"><CardContent className="py-8 text-center"><Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" /><h3 className="mb-2 text-lg font-medium">No moments yet</h3><p className="mb-4 text-sm text-muted-foreground">Add a moment to build your timeline with {personName}.</p><Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />Add Moment</Button></CardContent></Card>}

      {!loading && viewMode !== "ai-summary" && filteredEntries.length > 0 && <div className="relative"><div className="absolute bottom-0 left-6 top-0 w-px bg-border" /><div className="space-y-2">{filteredEntries.map((entry) => <div key={entry.id} className="relative flex gap-4 rounded-lg p-2 transition-colors hover:bg-muted/40"><div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Calendar className="h-4 w-4" /></div><div className="min-w-0 flex-1 rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><h3 className="font-medium">{entry.title}</h3>{entry.impact_level >= 3 && <Badge>Milestone</Badge>}</div><p className="text-xs text-muted-foreground">{formatDate(entry.happened_at)}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => onAskMira(`I want to reflect on "${entry.title}" from ${formatDate(entry.happened_at)}. ${entry.description || ""}`)}><MessageSquare className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => { setEditingEntry(entry); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMoment(entry)}><Trash2 className="h-4 w-4" /></Button></div></div>{entry.description && <p className="mt-3 text-sm text-muted-foreground">{entry.description}</p>}</div></div>)}</div></div>}

      <AddEventDialog people={people} editEvent={editingEntry} open={dialogOpen} onOpenChange={setDialogOpen} onCreated={loadTimeline} />
    </div>
  );
}
