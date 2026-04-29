import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { ArrowLeft, Archive, CalendarDays, Check, Clapperboard, Compass, ExternalLink, Handshake, Landmark, Loader2, Podcast, Sparkles, Trash2, UserSearch, Users, UsersRound } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useArchiveGroup, useGroup, useTrashGroup, useUpdateGroup } from "@/hooks/useGroups";
import { useGroupMemberships, useMoveMembershipStage } from "@/hooks/useGroupMemberships";
import { showToast } from "@/lib/toast";
import { parseArray, pretty, relativeDate } from "@/lib/group-utils";
import { AddMemberDialog } from "@/components/groups/AddMemberDialog";
import { BriefingTab } from "@/components/groups/BriefingTab";
import { GoalsTab } from "@/components/groups/GoalsTab";
import { MembershipSheet } from "@/components/groups/MembershipSheet";
import { PipelineColumn } from "@/components/groups/PipelineColumn";
import { SuggestMembersButton } from "@/components/groups/SuggestMembersButton";

const GROUP_TYPES = ["outreach", "relationship_care", "sales", "investors", "hiring", "research", "community", "learning", "creators", "other"];
const SENSITIVITIES = ["normal", "sensitive", "private"];
const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound, Users };

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type NoteSummary = Pick<Database["public"]["Tables"]["notes"]["Row"], "id" | "title">;
type Stage = { id: string; label: string; color?: string };
type AboutForm = Pick<ContactGroup, "name" | "description" | "purpose" | "type" | "sensitivity" | "icon" | "color">;

function GroupIcon({ icon }: { icon?: string | null }) {
  const Icon = icon && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : Users;
  return <Icon className="h-5 w-5" />;
}

export default function GroupDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
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
    queryKey: ["membership_source_notes", user?.id, selectedMembershipId, sourceNoteIds],
    enabled: !!user && sourceNoteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .in("id", sourceNoteIds);
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
