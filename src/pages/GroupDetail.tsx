import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowLeft, Archive, CalendarDays, CalendarIcon, Check, Clapperboard, Compass, ExternalLink, GripVertical, Handshake, Landmark, Loader2, Minus, Pencil, Plus, Podcast, Search, Sparkles, Target, Trash2, UserSearch, Users, UsersRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { useArchiveGroup, useGroup, useTrashGroup, useUpdateGroup } from "@/hooks/useGroups";
import { GroupMembershipWithPerson, useAddMembership, useArchiveMembership, useGroupMemberships, useMoveMembershipStage, useRemoveMembership, useUpdateMembership } from "@/hooks/useGroupMemberships";
import { useAICredits } from "@/hooks/useAICredits";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const GROUP_TYPES = ["outreach", "relationship_care", "sales", "investors", "hiring", "research", "community", "learning", "creators", "other"];
const SENSITIVITIES = ["normal", "sensitive", "private"];
const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound, Users };

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type Contact = Pick<Database["public"]["Tables"]["contacts"]["Row"], "id" | "name" | "company" | "role">;
type NoteSummary = Pick<Database["public"]["Tables"]["notes"]["Row"], "id" | "title">;
type ActionItem = Database["public"]["Tables"]["action_items"]["Row"] & { metadata?: Record<string, string> | null };
type GroupBriefing = Database["public"]["Tables"]["group_briefings"]["Row"];
type Stage = { id: string; label: string; color?: string };
type AttributeSchema = Record<string, { type: "number" | "text" | "select"; label: string; options?: string[]; min?: number; max?: number }>;
type NextStepSuggestion = { title: string; due_date_offset_days: number; priority: string; reasoning: string };
type SuccessCriterion = { label: string; target: number; current?: number; kind: "manual" | "interaction_count" | "action_item_count"; period_days?: number };

type AboutForm = Pick<ContactGroup, "name" | "description" | "purpose" | "type" | "sensitivity" | "icon" | "color">;

function parseArray<T>(value: Json): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseObject<T extends Record<string, unknown>>(value: Json): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : ({} as T);
}

function initials(name?: string | null) {
  return (name || "?").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function pretty(value?: string | null) {
  return (value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function GroupIcon({ icon }: { icon?: string | null }) {
  const Icon = icon && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : Users;
  return <Icon className="h-5 w-5" />;
}

function MemberCard({ membership, onOpen }: { membership: GroupMembershipWithPerson; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: membership.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className="w-full rounded-lg border bg-background p-3 text-left shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none"
    >
      <div className="flex items-start gap-2">
        <span {...listeners} {...attributes} className="mt-1 cursor-grab text-muted-foreground" onClick={(e) => e.stopPropagation()}><GripVertical className="h-4 w-4" /></span>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(membership.contacts?.name)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{membership.contacts?.name || "Unknown person"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={membership.priority === "urgent" ? "destructive" : "secondary"} className="text-[10px] capitalize">{membership.priority}</Badge>
            <span className="text-xs text-muted-foreground">{relativeDate(membership.last_movement_at)}</span>
          </div>
        </div>
      </div>
      {isDragging && <span className="sr-only">Dragging</span>}
    </button>
  );
}

function PipelineColumn({ stage, memberships, onOpen }: { stage: Stage; memberships: GroupMembershipWithPerson[]; onOpen: (m: GroupMembershipWithPerson) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-muted/30 p-3 transition-colors ${isOver ? "bg-accent" : ""}`}>
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-sm font-medium">{stage.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">{memberships.length}</Badge>
      </div>
      <div className="min-h-[160px] space-y-2">
        {memberships.map((membership) => <MemberCard key={membership.id} membership={membership} onOpen={() => onOpen(membership)} />)}
      </div>
    </div>
  );
}

function AddMemberDialog({ group, existingPersonIds }: { group: ContactGroup; existingPersonIds: Set<string> }) {
  const { user } = useAuth();
  const addMembership = useAddMembership();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", user?.id, "group-picker"],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("id, name, company, role").eq("user_id", user!.id).is("merged_into", null).order("name");
      if (error) throw error;
      return data || [];
    },
  });
  const available = contacts.filter((contact) => !existingPersonIds.has(contact.id) && contact.name.toLowerCase().includes(search.toLowerCase()));

  const submit = async () => {
    await Promise.all(selected.map((personId) => addMembership.mutateAsync({ groupId: group.id, personId })));
    showToast.success("Members added");
    setSelected([]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Member</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Members</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : available.map((contact) => (
              <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
                <Checkbox checked={selected.includes(contact.id)} onCheckedChange={(checked) => setSelected((prev) => checked ? [...prev, contact.id] : prev.filter((id) => id !== contact.id))} />
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(contact.name)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{contact.name}</span><span className="block truncate text-xs text-muted-foreground">{[contact.role, contact.company].filter(Boolean).join(" · ")}</span></span>
              </label>
            ))}
            {!isLoading && available.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No available people found.</p>}
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={selected.length === 0 || addMembership.isPending}>{addMembership.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Selected</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function formatDateInput(date: Date | undefined) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function NextStepsSection({ group, membership }: { group: ContactGroup; membership: GroupMembershipWithPerson }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", priority: membership.priority || "normal", notes: "" });
  const [dueDate, setDueDate] = useState<Date | undefined>();

  const { data: nextSteps = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["action_items", "group_membership", membership.id],
    enabled: !!user && !!membership.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items" as any)
        .select("*")
        .eq("user_id", user!.id)
        .eq("metadata->>group_membership_id", membership.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as unknown) as ActionItem[];
    },
  });

  const createNextStep = useMutation({
    mutationFn: async () => {
      const body = [form.title.trim(), form.notes.trim()].filter(Boolean).join("\n\n");
      const { error } = await supabase.from("action_items" as any).insert({
        user_id: user!.id,
        contact_id: membership.person_id,
        content: body,
        priority: form.priority,
        due_date: formatDateInput(dueDate) || null,
        status: "open",
        metadata: {
          group_membership_id: membership.id,
          group_id: group.id,
          person_id: membership.person_id,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action_items"] });
      qc.invalidateQueries({ queryKey: ["action_items", "group_membership", membership.id] });
      showToast.success("Next step added");
      setForm({ title: "", priority: membership.priority || "normal", notes: "" });
      setDueDate(undefined);
      setOpen(false);
    },
    onError: (error: Error) => showToast.error(error.message),
  });

  const suggestNextStep = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<NextStepSuggestion>("suggest-group-next-step", { body: { membership_id: membership.id } });
      if (error) throw error;
      return data!;
    },
    onSuccess: (suggestion) => {
      const due = new Date();
      due.setDate(due.getDate() + Number(suggestion.due_date_offset_days || 3));
      setForm({ title: suggestion.title, priority: suggestion.priority || "normal", notes: suggestion.reasoning || "" });
      setDueDate(due);
      setOpen(true);
      triggerCreditsRefresh();
      showToast.success("Next step suggested");
    },
    onError: (error: Error) => showToast.error(error.message || "Could not suggest next step"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Next Steps</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => suggestNextStep.mutate()} disabled={suggestNextStep.isPending}>
              {suggestNextStep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Suggest Next Step
            </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Next Step</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Next Step</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} placeholder="Follow up about the proposal" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Due date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dueDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dueDate ? dueDate.toLocaleDateString() : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((priority) => <SelectItem key={priority} value={priority} className="capitalize">{priority}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} className="min-h-24" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createNextStep.mutate()} disabled={!form.title.trim() || createNextStep.isPending}>
                {createNextStep.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
          </div>
      </div>
      <div className="min-h-6">
        {isLoading ? (
          <div className="flex h-6 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading next steps...</div>
        ) : nextSteps.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">No next steps yet.</p>
        ) : (
          <div className="space-y-2">
          {nextSteps.map((item) => (
            <button key={item.id} type="button" onClick={() => navigate("/dashboard/actions")} className="block w-full rounded-md border p-3 text-left text-sm hover:bg-accent">
              <span className="font-medium">{item.content.split("\n")[0]}</span>
              <span className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-[10px] capitalize">{item.status}</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{item.priority}</Badge>
                {item.due_date && <Badge variant="outline" className="text-[10px]">{new Date(item.due_date).toLocaleDateString()}</Badge>}
              </span>
            </button>
          ))}
          </div>
        )}
      </div>
    </div>
  );
}

type SuggestMembersResult = {
  suggestions_added: number;
  auto_applied?: number;
  structured_import?: { source_note?: { title?: string | null }; parsed_rows?: number; created_contacts?: number; imported_members?: number; updated_members?: number };
};

function SuggestMembersButton({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { credits } = useAICredits();
  const suggestMembers = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SuggestMembersResult>("suggest-group-members", { body: { group_id: groupId } });
      if (error) throw error;
      return data || { suggestions_added: 0, auto_applied: 0 };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      triggerCreditsRefresh();
      if (result.structured_import) {
        const imported = result.structured_import.imported_members || 0;
        const updated = result.structured_import.updated_members || 0;
        showToast.success(`${imported} member${imported === 1 ? "" : "s"} imported${updated > 0 ? ` · ${updated} updated` : ""}`);
        return;
      }
      const added = result.suggestions_added - (result.auto_applied || 0);
      if (result.auto_applied) {
        showToast.success(`${result.auto_applied} member${result.auto_applied === 1 ? "" : "s"} added${added > 0 ? ` · ${added} in Review Queue` : ""}`);
      } else {
        showToast.success(`${result.suggestions_added} suggestion${result.suggestions_added === 1 ? "" : "s"} added to Review Queue`);
      }
    },
    onError: (error: Error) => showToast.error(error.message || "Could not suggest members"),
  });

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => suggestMembers.mutate()} disabled={suggestMembers.isPending || (credits?.remainingCredits ?? 0) < 20}>
      {suggestMembers.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Match Members
    </Button>
  );
}

function BriefingTab({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { data: briefings = [], isLoading } = useQuery<GroupBriefing[]>({
    queryKey: ["group_briefings", groupId],
    queryFn: async () => {
      const { data, error } = await supabase.from("group_briefings").select("*").eq("group_id", groupId).order("generated_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });
  const latest = briefings[0];
  const generatedToday = latest ? new Date(latest.generated_at).toDateString() === new Date().toDateString() : false;
  const generateBriefing = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ briefing_markdown: string; generated_at: string }>("generate-group-briefing", { body: { group_id: groupId, period_days: 7 } });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group_briefings", groupId] });
      triggerCreditsRefresh();
      showToast.success("Briefing generated");
    },
    onError: (error: Error) => showToast.error(error.message || "Could not generate briefing"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Briefing</CardTitle>
          <Button onClick={() => generateBriefing.mutate()} disabled={generateBriefing.isPending || generatedToday}>
            {generateBriefing.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate New Briefing
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : latest ? (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{latest.briefing_markdown}</ReactMarkdown>
          </div>
        ) : <p className="text-sm text-muted-foreground">No briefing generated yet.</p>}
      </CardContent>
    </Card>
  );
}

function GoalsTab({ group }: { group: ContactGroup }) {
  const updateGroup = useUpdateGroup();
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<SuccessCriterion>({ label: "", target: 1, current: 0, kind: "manual" });
  const criteria = parseArray<SuccessCriterion>(group.success_criteria);
  const { data: interactionCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ["group_goal_interaction_counts", group.id, group.success_criteria],
    queryFn: async () => {
      const entries = await Promise.all(criteria.map(async (criterion, index) => {
        if (criterion.kind !== "interaction_count") return [index, Number(criterion.current || 0)] as const;
        const since = new Date();
        since.setDate(since.getDate() - Number(criterion.period_days || 30));
        const { count, error } = await supabase
          .from("contact_interactions")
          .select("id", { count: "exact", head: true })
          .eq("group_id", group.id)
          .gte("interaction_date", since.toISOString().slice(0, 10));
        if (error) throw error;
        return [index, count || 0] as const;
      }));
      return Object.fromEntries(entries);
    },
  });
  const saveCriteria = (next: SuccessCriterion[], message: string) => updateGroup.mutate({ id: group.id, success_criteria: next as unknown as Json }, { onSuccess: () => showToast.success(message) });
  const setManualValue = (index: number, value: number) => saveCriteria(criteria.map((criterion, i) => i === index ? { ...criterion, current: Math.max(0, value) } : criterion), "Goal updated");
  const openEdit = (index: number | "new") => {
    setEditingIndex(index);
    setForm(index === "new" ? { label: "", target: 1, current: 0, kind: "manual" } : { ...criteria[index], current: criteria[index].current || 0 });
  };
  const submit = () => {
    if (!form.label.trim()) return;
    const normalized = { ...form, label: form.label.trim(), target: Math.max(1, Number(form.target || 1)), current: Number(form.current || 0) };
    saveCriteria(editingIndex === "new" ? [...criteria, normalized] : criteria.map((criterion, index) => index === editingIndex ? normalized : criterion), editingIndex === "new" ? "Goal added" : "Goal updated");
    setEditingIndex(null);
  };
  const deleteGoal = () => {
    if (typeof editingIndex !== "number") return;
    saveCriteria(criteria.filter((_, index) => index !== editingIndex), "Goal deleted");
    setEditingIndex(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" className="gap-1.5" onClick={() => openEdit("new")}><Plus className="h-4 w-4" /> Add Goal</Button></div>
      {criteria.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12 text-center"><Target className="mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No goals yet.</p><p className="mt-1 text-sm text-muted-foreground">Add a goal to track this group’s mission.</p></CardContent></Card>
      ) : criteria.map((criterion, index) => {
        const current = criterion.kind === "interaction_count" ? interactionCounts[index] ?? 0 : Number(criterion.current || 0);
        const target = Math.max(1, Number(criterion.target || 1));
        return (
          <Card key={`${criterion.label}-${index}`}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate font-medium">{criterion.label}</p><p className="text-sm text-muted-foreground">{current}/{target} · {pretty(criterion.kind)}{criterion.kind === "interaction_count" ? ` · last ${criterion.period_days || 30} days` : ""}</p></div>
                <Button variant="ghost" size="icon" onClick={() => openEdit(index)}><Pencil className="h-4 w-4" /></Button>
              </div>
              <Progress value={Math.min(100, Math.round((current / target) * 100))} />
              {criterion.kind === "manual" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setManualValue(index, current + 1)}><Plus className="mr-1 h-4 w-4" />1</Button>
                  <Button size="sm" variant="outline" onClick={() => setManualValue(index, current - 1)}><Minus className="mr-1 h-4 w-4" />1</Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(index)}>Set value</Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={editingIndex !== null} onOpenChange={(open) => !open && setEditingIndex(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingIndex === "new" ? "Add Goal" : "Edit Goal"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Label</Label><Input value={form.label} onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Target</Label><Input type="number" min={1} value={form.target} onChange={(e) => setForm((current) => ({ ...current, target: Number(e.target.value || 1) }))} /></div><div className="space-y-2"><Label>Current</Label><Input type="number" min={0} value={form.current || 0} onChange={(e) => setForm((current) => ({ ...current, current: Number(e.target.value || 0) }))} disabled={form.kind === "interaction_count"} /></div></div>
            <div className="space-y-2"><Label>Kind</Label><Select value={form.kind} onValueChange={(kind) => setForm((current) => ({ ...current, kind: kind as SuccessCriterion["kind"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="interaction_count">Interaction Count</SelectItem><SelectItem value="action_item_count">Action Item Count</SelectItem></SelectContent></Select></div>
            {form.kind === "interaction_count" && <div className="space-y-2"><Label>Period days</Label><Input type="number" min={1} value={form.period_days || 30} onChange={(e) => setForm((current) => ({ ...current, period_days: Number(e.target.value || 30) }))} /></div>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editingIndex !== "new" && <Button variant="destructive" onClick={deleteGoal}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
            <Button onClick={submit} disabled={!form.label.trim() || updateGroup.isPending}>{updateGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MembershipSheet({ group, membership, notes, open, onOpenChange }: { group: ContactGroup; membership: GroupMembershipWithPerson | null; notes: NoteSummary[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const updateMembership = useUpdateMembership();
  const removeMembership = useRemoveMembership();
  const archiveMembership = useArchiveMembership();
  const stages = parseArray<Stage>(group.stages);
  const schema = parseObject<AttributeSchema>(group.attributes_schema);
  const values = parseObject<Record<string, string | number>>(membership?.attributes ?? {});
  if (!membership) return <Sheet open={open} onOpenChange={onOpenChange} />;

  const update = (updates: Parameters<typeof updateMembership.mutate>[0]) => updateMembership.mutate(updates, { onSuccess: () => showToast.success("Membership updated") });
  const updateField = (field: "status" | "priority" | "reason" | "notes", value: string | null) => update({ id: membership.id, groupId: group.id, personId: membership.person_id, [field]: value });
  const updateAttribute = (key: string, value: string | number) => update({ id: membership.id, groupId: group.id, personId: membership.person_id, attributes: { ...values, [key]: value } as Json });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3 pr-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm text-primary">{initials(membership.contacts?.name)}</span>
            <span className="min-w-0"><span className="block truncate">{membership.contacts?.name || "Unknown person"}</span><Link to={`/dashboard/people/${membership.person_id}`} className="text-sm font-normal text-muted-foreground hover:text-foreground">Open profile</Link></span>
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Status</Label><Select value={membership.status || ""} onValueChange={(value) => updateField("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Priority</Label><Select value={membership.priority} onValueChange={(value) => updateField("priority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Reason</Label><Textarea defaultValue={membership.reason || ""} onBlur={(e) => updateField("reason", e.target.value || null)} /></div>
          <div className="space-y-2"><Label>Notes</Label><Textarea defaultValue={membership.notes || ""} onBlur={(e) => updateField("notes", e.target.value || null)} className="min-h-24" /></div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Attributes</h3>
            {Object.entries(schema).length === 0 ? <p className="text-sm text-muted-foreground">No attributes configured.</p> : Object.entries(schema).map(([key, config]) => (
              <div key={key} className="space-y-2">
                <Label>{config.label}</Label>
                {config.type === "select" ? <Select value={String(values[key] ?? "")} onValueChange={(value) => updateAttribute(key, value)}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{(config.options || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input type={config.type === "number" ? "number" : "text"} min={config.min} max={config.max} defaultValue={String(values[key] ?? "")} onBlur={(e) => updateAttribute(key, config.type === "number" ? Number(e.target.value || 0) : e.target.value)} />}
              </div>
            ))}
          </div>
          <NextStepsSection group={group} membership={membership} />
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Source Notes</h3>
            {notes.length === 0 ? <p className="text-sm text-muted-foreground">No source notes.</p> : notes.map((note) => <Link key={note.id} to={`/dashboard/notes/${note.id}`} className="block rounded-md border p-3 text-sm hover:bg-accent">{note.title || "Untitled"}</Link>)}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => archiveMembership.mutate({ id: membership.id, groupId: group.id, personId: membership.person_id }, { onSuccess: () => { showToast.success("Membership archived"); onOpenChange(false); } })}><Archive className="mr-2 h-4 w-4" /> Archive</Button>
            <Button variant="destructive" className="flex-1" onClick={() => removeMembership.mutate({ id: membership.id, groupId: group.id, personId: membership.person_id }, { onSuccess: () => { showToast.success("Removed from group"); onOpenChange(false); } })}><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function GroupDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: group, isLoading } = useGroup(slug);
  const { data: memberships = [] } = useGroupMemberships(group?.id);
  const updateGroup = useUpdateGroup();
  const archiveGroup = useArchiveGroup();
  const trashGroup = useTrashGroup();
  const moveMembership = useMoveMembershipStage();
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [aboutForm, setAboutForm] = useState<AboutForm | null>(null);
  const [activeTab, setActiveTab] = useState(() => window.matchMedia("(max-width: 767px)").matches ? "list" : "pipeline");
  const selectedMembership = memberships.find((m) => m.id === selectedMembershipId) || null;
  const stages = parseArray<Stage>(group?.stages ?? []);
  const existingPersonIds = useMemo(() => new Set(memberships.map((m) => m.person_id)), [memberships]);
  const sourceNoteIds = selectedMembership?.source_note_ids || [];
  const { data: sourceNotes = [] } = useQuery<NoteSummary[]>({
    queryKey: ["membership_source_notes", selectedMembershipId, sourceNoteIds],
    enabled: sourceNoteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("notes").select("id, title").in("id", sourceNoteIds);
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) return <div className="flex max-w-5xl justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!group) return <div className="max-w-5xl"><SEOHead title="Group not found — Menerio" noIndex /><Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/groups")}><ArrowLeft className="mr-1 h-4 w-4" />Back to Groups</Button><p className="mt-8 text-sm text-muted-foreground">Group not found.</p></div>;

  const form = aboutForm || { name: group.name, description: group.description, purpose: group.purpose, type: group.type, sensitivity: group.sensitivity, icon: group.icon, color: group.color };
  const byStage = (stageId: string) => memberships.filter((membership) => membership.status === stageId);
  const onDragEnd = (event: DragEndEvent) => {
    const membershipId = String(event.active.id);
    const newStatus = event.over?.id ? String(event.over.id) : null;
    if (newStatus && memberships.find((m) => m.id === membershipId)?.status !== newStatus) moveMembership.mutate({ membershipId, newStatus });
  };
  const saveAbout = () => updateGroup.mutate({ id: group.id, ...form }, { onSuccess: () => { setAboutForm(null); showToast.success("Group updated"); } });

  return (
    <div className="max-w-5xl">
      <SEOHead title={`${group.name} — Groups — Menerio`} noIndex />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/groups")} className="mb-3"><ArrowLeft className="mr-1 h-4 w-4" />Back to Groups</Button>
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><GroupIcon icon={group.icon} /></div><h1 className="truncate text-2xl font-display font-bold">{group.name}</h1></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AddMemberDialog group={group} existingPersonIds={existingPersonIds} />
          <Button variant="outline" size="sm" onClick={() => setActiveTab("about")}>Edit</Button>
          <Button variant="outline" size="icon" onClick={() => archiveGroup.mutate(group.id, { onSuccess: () => showToast.success("Group archived") })}><Archive className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => trashGroup.mutate(group.id, { onSuccess: () => { showToast.success("Group moved to trash"); navigate("/dashboard/groups"); } })}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Badge variant="secondary">{pretty(group.type)}</Badge><span>{memberships.length} member{memberships.length === 1 ? "" : "s"}</span><span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Created on {new Date(group.created_at).toLocaleDateString()}</span></div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap"><TabsTrigger value="pipeline">Pipeline</TabsTrigger><TabsTrigger value="briefing">Briefing</TabsTrigger><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="goals">Goals</TabsTrigger><TabsTrigger value="about">About</TabsTrigger></TabsList>
        <TabsContent value="pipeline" className="mt-0">
          <div className="mb-4 flex justify-end"><SuggestMembersButton groupId={group.id} /></div>
          <DndContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {stages.map((stage) => <PipelineColumn key={stage.id} stage={stage} memberships={byStage(stage.id)} onOpen={(membership) => setSelectedMembershipId(membership.id)} />)}
            </div>
          </DndContext>
        </TabsContent>
        <TabsContent value="briefing" className="mt-0">
          <BriefingTab groupId={group.id} />
        </TabsContent>
        <TabsContent value="list" className="mt-0">
          <Card><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Joined</TableHead><TableHead>Last Movement</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{memberships.map((membership) => <TableRow key={membership.id} className="cursor-pointer" onClick={() => setSelectedMembershipId(membership.id)}><TableCell className="font-medium">{membership.contacts?.name || "Unknown"}</TableCell><TableCell>{stages.find((s) => s.id === membership.status)?.label || membership.status}</TableCell><TableCell><Badge variant="secondary" className="capitalize">{membership.priority}</Badge></TableCell><TableCell>{new Date(membership.joined_at).toLocaleDateString()}</TableCell><TableCell>{relativeDate(membership.last_movement_at)}</TableCell><TableCell className="max-w-48 truncate">{membership.reason || "—"}</TableCell></TableRow>)}</TableBody></Table></Card>
        </TabsContent>
        <TabsContent value="goals" className="mt-0">
          <GoalsTab group={group} />
        </TabsContent>
        <TabsContent value="about" className="mt-0">
          <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">About</CardTitle><Button asChild variant="outline" size="sm"><Link to={`/lexicon/group-${group.slug}`}><ExternalLink className="mr-2 h-4 w-4" />Open Wiki Page</Link></Button></div></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setAboutForm({ ...form, name: e.target.value })} /></div><div className="space-y-2"><Label>Type</Label><Select value={form.type} onValueChange={(value) => setAboutForm({ ...form, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GROUP_TYPES.map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ""} onChange={(e) => setAboutForm({ ...form, description: e.target.value || null })} /></div><div className="space-y-2"><Label>Purpose</Label><Textarea value={form.purpose || ""} onChange={(e) => setAboutForm({ ...form, purpose: e.target.value || null })} /></div><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Sensitivity</Label><Select value={form.sensitivity} onValueChange={(value) => setAboutForm({ ...form, sensitivity: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SENSITIVITIES.map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Icon</Label><Input value={form.icon || ""} onChange={(e) => setAboutForm({ ...form, icon: e.target.value || null })} /></div><div className="space-y-2"><Label>Color</Label><Input value={form.color || ""} onChange={(e) => setAboutForm({ ...form, color: e.target.value || null })} /></div></div><Button onClick={saveAbout} disabled={updateGroup.isPending}>{updateGroup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save changes</Button></CardContent></Card>
        </TabsContent>
      </Tabs>
      <MembershipSheet group={group} membership={selectedMembership} notes={sourceNotes} open={!!selectedMembershipId} onOpenChange={(open) => !open && setSelectedMembershipId(null)} />
    </div>
  );
}
