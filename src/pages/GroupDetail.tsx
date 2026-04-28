import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowLeft, Archive, CalendarDays, Check, Clapperboard, Compass, GripVertical, Handshake, Landmark, Loader2, Plus, Podcast, Search, Sparkles, Trash2, UserSearch, Users, UsersRound } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useArchiveGroup, useGroup, useTrashGroup, useUpdateGroup } from "@/hooks/useGroups";
import { GroupMembershipWithPerson, useAddMembership, useArchiveMembership, useGroupMemberships, useMoveMembershipStage, useRemoveMembership, useUpdateMembership } from "@/hooks/useGroupMemberships";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const GROUP_TYPES = ["outreach", "relationship_care", "sales", "investors", "hiring", "research", "community", "learning", "creators", "other"];
const SENSITIVITIES = ["normal", "sensitive", "private"];
const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound, Users };

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type Contact = Pick<Database["public"]["Tables"]["contacts"]["Row"], "id" | "name" | "company" | "role">;
type NoteSummary = Pick<Database["public"]["Tables"]["notes"]["Row"], "id" | "title">;
type Stage = { id: string; label: string; color?: string };
type AttributeSchema = Record<string, { type: "number" | "text" | "select"; label: string; options?: string[]; min?: number; max?: number }>;

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
  const [activeTab, setActiveTab] = useState("pipeline");
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
        <TabsList><TabsTrigger value="pipeline">Pipeline</TabsTrigger><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="about">About</TabsTrigger></TabsList>
        <TabsContent value="pipeline" className="mt-0">
          <DndContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {stages.map((stage) => <PipelineColumn key={stage.id} stage={stage} memberships={byStage(stage.id)} onOpen={(membership) => setSelectedMembershipId(membership.id)} />)}
            </div>
          </DndContext>
        </TabsContent>
        <TabsContent value="list" className="mt-0">
          <Card><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Joined</TableHead><TableHead>Last Movement</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{memberships.map((membership) => <TableRow key={membership.id} className="cursor-pointer" onClick={() => setSelectedMembershipId(membership.id)}><TableCell className="font-medium">{membership.contacts?.name || "Unknown"}</TableCell><TableCell>{stages.find((s) => s.id === membership.status)?.label || membership.status}</TableCell><TableCell><Badge variant="secondary" className="capitalize">{membership.priority}</Badge></TableCell><TableCell>{new Date(membership.joined_at).toLocaleDateString()}</TableCell><TableCell>{relativeDate(membership.last_movement_at)}</TableCell><TableCell className="max-w-48 truncate">{membership.reason || "—"}</TableCell></TableRow>)}</TableBody></Table></Card>
        </TabsContent>
        <TabsContent value="about" className="mt-0">
          <Card><CardHeader><CardTitle className="text-base">About</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setAboutForm({ ...form, name: e.target.value })} /></div><div className="space-y-2"><Label>Type</Label><Select value={form.type} onValueChange={(value) => setAboutForm({ ...form, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GROUP_TYPES.map((type) => <SelectItem key={type} value={type}>{pretty(type)}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ""} onChange={(e) => setAboutForm({ ...form, description: e.target.value || null })} /></div><div className="space-y-2"><Label>Purpose</Label><Textarea value={form.purpose || ""} onChange={(e) => setAboutForm({ ...form, purpose: e.target.value || null })} /></div><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Sensitivity</Label><Select value={form.sensitivity} onValueChange={(value) => setAboutForm({ ...form, sensitivity: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SENSITIVITIES.map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Icon</Label><Input value={form.icon || ""} onChange={(e) => setAboutForm({ ...form, icon: e.target.value || null })} /></div><div className="space-y-2"><Label>Color</Label><Input value={form.color || ""} onChange={(e) => setAboutForm({ ...form, color: e.target.value || null })} /></div></div><Button onClick={saveAbout} disabled={updateGroup.isPending}>{updateGroup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save changes</Button></CardContent></Card>
        </TabsContent>
      </Tabs>
      <MembershipSheet group={group} membership={selectedMembership} notes={sourceNotes} open={!!selectedMembershipId} onOpenChange={(open) => !open && setSelectedMembershipId(null)} />
    </div>
  );
}
