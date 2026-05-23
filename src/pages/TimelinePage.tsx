import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Calendar, CheckCircle2, ChevronDown, FileText, Filter, Loader2, Pencil, Search, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SEOHead } from "@/components/SEOHead";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import AddEventDialog, { type EditMomentData, type TimelineContact } from "@/components/timeline/AddEventDialog";

interface TimelineMoment {
  id: string;
  happened_at: string;
  happened_end: string | null;
  title: string;
  description: string | null;
  status: string;
  confidence_date: number;
  confidence_truth: number;
  impact_level: number;
  source: string;
  verified: boolean;
  is_potential_major: boolean;
  participants?: TimelineContact[];
  provenance?: { id: string; document_id: string; snippet_en: string | null; page_number: number | null }[];
}

const statusClasses: Record<string, string> = {
  past_fact: "bg-success/10 text-success border-success/20",
  future_plan: "bg-info/10 text-info border-info/20",
  ongoing: "bg-warning/10 text-warning border-warning/20",
  unknown: "bg-muted text-muted-foreground border-border",
};

const impactLabels: Record<number, string> = { 1: "Minor", 2: "Noticeable", 3: "Strong Impact", 4: "Life-Shaping" };
const statuses = ["past_fact", "future_plan", "ongoing", "unknown"];

export default function TimelinePage() {
  const { user } = useAuth();
  const [moments, setMoments] = useState<TimelineMoment[]>([]);
  const [people, setPeople] = useState<TimelineContact[]>([]);
  const [participantMap, setParticipantMap] = useState<Record<string, string[]>>({});
  const [provenanceMap, setProvenanceMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedMoment, setSelectedMoment] = useState<TimelineMoment | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMomentData, setEditMomentData] = useState<EditMomentData | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [minImpact, setMinImpact] = useState(1);
  const [minConfTruth, setMinConfTruth] = useState(0);
  const [minConfDate, setMinConfDate] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [personFilter, setPersonFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");


  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    const [momentsRes, peopleRes, partsRes, provRes] = await Promise.all([
      supabase.from("moments" as any).select("*").eq("user_id", user.id).is("deleted_at", null).order("happened_at", { ascending: false }),
      supabase.from("contacts").select("id, name, relationship").eq("user_id", user.id).is("merged_into", null).order("name"),
      supabase.from("moment_participants" as any).select("moment_id, person_id"),
      supabase.from("moment_provenance" as any).select("moment_id, document_id").eq("user_id", user.id),
    ]);
    setMoments((momentsRes.data || []) as any);
    setPeople((peopleRes.data || []) as TimelineContact[]);

    const parts: Record<string, string[]> = {};
    for (const row of (partsRes.data || []) as any[]) {
      if (!parts[row.moment_id]) parts[row.moment_id] = [];
      parts[row.moment_id].push(row.person_id);
    }
    setParticipantMap(parts);

    const prov: Record<string, string[]> = {};
    for (const row of (provRes.data || []) as any[]) {
      if (!prov[row.moment_id]) prov[row.moment_id] = [];
      prov[row.moment_id].push(row.document_id);
    }
    setProvenanceMap(prov);
    setLoading(false);
  };

  useEffect(() => { if (user) fetchData(); }, [user]);

  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setCreateDialogOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filteredMoments = useMemo(() => moments.filter((m) => {
    if (m.impact_level < minImpact) return false;
    if (m.confidence_truth < minConfTruth) return false;
    if (m.confidence_date < minConfDate) return false;
    if (statusFilter.length > 0 && !statusFilter.includes(m.status)) return false;
    if (personFilter.length > 0) {
      const ids = participantMap[m.id] || [];
      if (!personFilter.some((id) => ids.includes(id))) return false;
    }
    return true;
  }), [moments, minImpact, minConfTruth, minConfDate, statusFilter, personFilter, participantMap]);

  const groupedByYear = useMemo(() => {
    const groups: Record<string, TimelineMoment[]> = {};
    for (const m of filteredMoments) {
      const year = m.happened_at.split("-")[0];
      if (!groups[year]) groups[year] = [];
      groups[year].push(m);
    }
    return Object.entries(groups).sort(([a], [b]) => Number(b) - Number(a));
  }, [filteredMoments]);

  const toggle = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);

  const openMomentDrawer = async (moment: TimelineMoment) => {
    const [partRes, provRes] = await Promise.all([
      supabase.from("moment_participants" as any).select("person_id").eq("moment_id", moment.id),
      supabase.from("moment_provenance" as any).select("id, document_id, snippet_en, page_number").eq("moment_id", moment.id),
    ]);
    const participantIds = ((partRes.data || []) as any[]).map((p) => p.person_id);
    setSelectedMoment({ ...moment, participants: people.filter((p) => participantIds.includes(p.id)), provenance: (provRes.data || []) as any });
    setDrawerOpen(true);
  };

  const openEditDialog = (moment: TimelineMoment) => {
    setEditMomentData({
      id: moment.id,
      title: moment.title,
      description: moment.description,
      happened_at: moment.happened_at,
      happened_end: moment.happened_end,
      status: moment.status,
      impact_level: moment.impact_level,
      confidence_date: moment.confidence_date,
      confidence_truth: moment.confidence_truth,
      participantIds: (moment.participants || []).map((p) => p.id),
    });
    setDrawerOpen(false);
    setEditDialogOpen(true);
  };

  const clearFilters = () => { setMinImpact(1); setMinConfTruth(0); setMinConfDate(0); setStatusFilter([]); setPersonFilter([]); };

  return (
    <div className="space-y-6">
      <SEOHead title="Timeline — Menerio" noIndex />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div><h1 className="text-2xl font-display font-bold">Timeline</h1><p className="text-sm text-muted-foreground">{filteredMoments.length} moment{filteredMoments.length !== 1 ? "s" : ""} shown</p></div>
        <div className="flex gap-2">
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}><CollapsibleTrigger asChild><Button variant="outline" size="sm"><Filter className="mr-2 h-4 w-4" />Filters{personFilter.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{personFilter.length}</Badge>}<ChevronDown className="ml-1 h-3 w-3" /></Button></CollapsibleTrigger></Collapsible>
          <AddEventDialog people={people} onCreated={fetchData} />
        </div>
      </div>

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <CollapsibleContent>
          <Card><CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2"><Label className="text-xs">Min Impact: {minImpact} — {impactLabels[minImpact]}</Label><Slider value={[minImpact]} onValueChange={([v]) => setMinImpact(v)} min={1} max={4} step={1} /></div>
              <div className="space-y-2"><Label className="text-xs">Min Confidence (Truth): {minConfTruth}</Label><Slider value={[minConfTruth]} onValueChange={([v]) => setMinConfTruth(v)} min={0} max={10} step={1} /></div>
              <div className="space-y-2"><Label className="text-xs">Min Confidence (Date): {minConfDate}</Label><Slider value={[minConfDate]} onValueChange={([v]) => setMinConfDate(v)} min={0} max={10} step={1} /></div>
            </div>
            {people.length > 0 && <div className="space-y-2"><Label className="text-xs">People</Label><div className="flex flex-wrap gap-2">{people.map((p) => <label key={p.id} className="flex items-center gap-1.5 text-sm cursor-pointer"><Checkbox checked={personFilter.includes(p.id)} onCheckedChange={() => toggle(p.id, setPersonFilter)} />{p.name}</label>)}</div></div>}
            <div className="space-y-2"><Label className="text-xs">Status</Label><div className="flex flex-wrap gap-2">{statuses.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer"><Checkbox checked={statusFilter.includes(s)} onCheckedChange={() => toggle(s, setStatusFilter)} />{s.replace("_", " ")}</label>)}</div></div>
            <Button variant="ghost" size="sm" onClick={clearFilters}>Show All</Button>
          </CardContent></Card>
        </CollapsibleContent>
      </Collapsible>

      {loading ? <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div> : groupedByYear.length === 0 ? <div className="text-center py-20 text-muted-foreground space-y-4"><Calendar className="mx-auto h-12 w-12 opacity-40" /><p className="text-lg font-medium">No moments yet</p><p className="text-sm">Add moments manually to build your timeline.</p><AddEventDialog people={people} onCreated={fetchData} /></div> : <div className="space-y-8">{groupedByYear.map(([year, yearMoments]) => <div key={year}><div className="flex items-center gap-3 mb-4"><span className="text-2xl font-bold text-foreground">{year}</span><Separator className="flex-1" /><span className="text-xs text-muted-foreground">{yearMoments.length} moment{yearMoments.length !== 1 ? "s" : ""}</span></div><div className="relative ml-4 border-l-2 border-border pl-6 space-y-4">{yearMoments.map((moment) => <button key={moment.id} onClick={() => openMomentDrawer(moment)} className="block w-full text-left group"><div className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-background bg-primary mt-1" /><Card className="transition-shadow hover:shadow-md cursor-pointer"><CardContent className="py-3 px-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="font-medium text-sm truncate">{moment.title}</p><p className="text-xs text-muted-foreground mt-0.5">{format(new Date(moment.happened_at), "MMM d, yyyy")}{moment.happened_end && ` — ${format(new Date(moment.happened_end), "MMM d, yyyy")}`}</p></div><div className="flex items-center gap-1.5 shrink-0"><Badge variant="outline" className={`text-[10px] px-1.5 ${statusClasses[moment.status] || ""}`}>{moment.status.replace("_", " ")}</Badge>{(provenanceMap[moment.id] || []).length > 0 && <FileText className="h-3 w-3 text-muted-foreground" />}{moment.verified && <CheckCircle2 className="h-3 w-3 text-success" />}</div></div></CardContent></Card></button>)}</div></div>)}</div>}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}><SheetContent className="sm:max-w-lg overflow-y-auto">{selectedMoment && <><SheetHeader><SheetTitle>{selectedMoment.title}</SheetTitle><SheetDescription>{format(new Date(selectedMoment.happened_at), "MMMM d, yyyy")}{selectedMoment.happened_end && ` — ${format(new Date(selectedMoment.happened_end), "MMMM d, yyyy")}`}</SheetDescription></SheetHeader><div className="mt-6 space-y-6"><Button variant="outline" size="sm" onClick={() => openEditDialog(selectedMoment)}><Pencil className="mr-2 h-4 w-4" /> Edit Moment</Button>{selectedMoment.description && <p className="text-sm text-muted-foreground">{selectedMoment.description}</p>}<div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Impact</p><p className="text-lg font-bold">{selectedMoment.impact_level}/4</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Conf. Truth</p><p className="text-lg font-bold">{selectedMoment.confidence_truth}/10</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Conf. Date</p><p className="text-lg font-bold">{selectedMoment.confidence_date}/10</p></div></div><div className="flex gap-2 flex-wrap"><Badge variant="outline" className={statusClasses[selectedMoment.status] || ""}>{selectedMoment.status.replace("_", " ")}</Badge><Badge variant="outline">Source: {selectedMoment.source}</Badge></div>{selectedMoment.participants && selectedMoment.participants.length > 0 && <div><h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> Participants</h2><div className="flex gap-2 flex-wrap">{selectedMoment.participants.map((p) => <Badge key={p.id} variant="secondary">{p.name}</Badge>)}</div></div>}</div></>}</SheetContent></Sheet>
      <AddEventDialog people={people} onCreated={fetchData} editEvent={editMomentData} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      <AddEventDialog people={people} onCreated={fetchData} open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
