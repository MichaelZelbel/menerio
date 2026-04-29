import { Link } from "react-router-dom";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Database, Json } from "@/integrations/supabase/types";
import { useArchiveMembership, useRemoveMembership, useUpdateMembership, type GroupMembershipWithPerson } from "@/hooks/useGroupMemberships";
import { showToast } from "@/lib/toast";
import { initials, parseArray } from "@/lib/group-utils";
import { NextStepsSection } from "./NextStepsSection";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type NoteSummary = Pick<Database["public"]["Tables"]["notes"]["Row"], "id" | "title">;
type Stage = { id: string; label: string; color?: string };
type AttributeSchema = Record<string, { type: "number" | "text" | "select"; label: string; options?: string[]; min?: number; max?: number }>;

function parseObject<T extends Record<string, unknown>>(value: Json | null | undefined): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : ({} as T);
}

export function MembershipSheet({ group, membership, notes, open, onOpenChange }: { group: ContactGroup; membership: GroupMembershipWithPerson | null; notes: NoteSummary[]; open: boolean; onOpenChange: (open: boolean) => void }) {
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
