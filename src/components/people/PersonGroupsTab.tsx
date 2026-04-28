import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  Check,
  Clapperboard,
  Compass,
  Edit2,
  Handshake,
  Landmark,
  Loader2,
  Plus,
  Podcast,
  Sparkles,
  UserSearch,
  Users,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Json } from "@/integrations/supabase/types";
import { useAddMembership, usePersonGroupMemberships, useUpdateMembership, type PersonGroupMembership } from "@/hooks/useGroupMemberships";
import { useGroups } from "@/hooks/useGroups";
import { showToast } from "@/lib/toast";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound, Users };

type Stage = { id: string; label: string };

type EditForm = {
  status: string;
  priority: string;
  reason: string;
  notes: string;
};

function parseStages(value: Json): Stage[] {
  return Array.isArray(value) ? (value as Stage[]) : [];
}

function pretty(value?: string | null) {
  return (value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function GroupIcon({ icon }: { icon?: string | null }) {
  const Icon = icon && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : Users;
  return <Icon className="h-4 w-4" />;
}

function MembershipRow({ membership }: { membership: PersonGroupMembership }) {
  const updateMembership = useUpdateMembership();
  const group = membership.contact_groups;
  const stages = parseStages(group?.stages ?? []);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>({
    status: membership.status || stages[0]?.id || "",
    priority: membership.priority,
    reason: membership.reason || "",
    notes: membership.notes || "",
  });

  if (!group) return null;

  const statusLabel = stages.find((stage) => stage.id === membership.status)?.label || pretty(membership.status);

  const save = () => {
    updateMembership.mutate(
      {
        id: membership.id,
        groupId: membership.group_id,
        personId: membership.person_id,
        status: form.status || null,
        priority: form.priority,
        reason: form.reason.trim() || null,
        notes: form.notes.trim() || null,
      },
      {
        onSuccess: () => {
          showToast.success("Membership updated");
          setEditing(false);
        },
      },
    );
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <GroupIcon icon={group.icon} />
            </div>
            <div className="min-w-0 space-y-1">
              <Link to={`/dashboard/groups/${group.slug}`} className="block truncate font-medium hover:text-primary">
                {group.name}
              </Link>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{statusLabel || "No status"}</Badge>
                <Badge variant={membership.priority === "urgent" ? "destructive" : "outline"} className="capitalize">
                  {membership.priority}
                </Badge>
              </div>
              {membership.reason && <p className="text-sm text-muted-foreground">{membership.reason}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setEditing((current) => !current)}>
            <Edit2 className="h-4 w-4" />
          </Button>
        </div>

        {editing && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(status) => setForm((current) => ({ ...current, status }))}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((priority) => <SelectItem key={priority} value={priority} className="capitalize">{priority}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={updateMembership.isPending}>
                {updateMembership.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddToGroupDialog({ personId, memberships }: { personId: string; memberships: PersonGroupMembership[] }) {
  const { data: groups = [], isLoading } = useGroups();
  const addMembership = useAddMembership();
  const [open, setOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const memberGroupIds = useMemo(() => new Set(memberships.map((membership) => membership.group_id)), [memberships]);
  const availableGroups = groups.filter((group) => !group.archived_at && !memberGroupIds.has(group.id));

  const add = () => {
    if (!selectedGroupId) return;
    addMembership.mutate(
      { groupId: selectedGroupId, personId },
      {
        onSuccess: () => {
          showToast.success("Added to group");
          setSelectedGroupId("");
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add to another group</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add to another group</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Group</Label>
          <Select value={selectedGroupId} onValueChange={setSelectedGroupId} disabled={isLoading || availableGroups.length === 0}>
            <SelectTrigger><SelectValue placeholder={availableGroups.length === 0 ? "No available groups" : "Select group"} /></SelectTrigger>
            <SelectContent>
              {availableGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={add} disabled={!selectedGroupId || addMembership.isPending}>
            {addMembership.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PersonGroupsTab({ personId }: { personId: string }) {
  const { data: memberships = [], isLoading } = usePersonGroupMemberships(personId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Groups</h2>
          <p className="text-sm text-muted-foreground">{memberships.length} active membership{memberships.length === 1 ? "" : "s"}</p>
        </div>
        <AddToGroupDialog personId={personId} memberships={memberships} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : memberships.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Archive className="h-7 w-7 text-muted-foreground" />
            <div>
              <p className="font-medium">No group memberships</p>
              <p className="text-sm text-muted-foreground">Add this person to a group to track context and progress.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {memberships.map((membership) => <MembershipRow key={membership.id} membership={membership} />)}
        </div>
      )}
    </div>
  );
}
