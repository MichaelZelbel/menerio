import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

/** The free-text fields as typed, before they are saved. */
type Draft = { reason: string; notes: string; attributes: Record<string, string> };

function draftFrom(membership: GroupMembershipWithPerson | null): Draft {
  const attributes = parseObject<Record<string, string | number>>(membership?.attributes ?? {});
  return {
    reason: membership?.reason || "",
    notes: membership?.notes || "",
    attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, String(value ?? "")])),
  };
}

// Render keyed by membership id (GroupDetail does), so the draft starts from
// the member that is open.
export function MembershipSheet({ group, membership, notes, open, onOpenChange }: { group: ContactGroup; membership: GroupMembershipWithPerson | null; notes: NoteSummary[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const updateMembership = useUpdateMembership();
  const removeMembership = useRemoveMembership();
  const archiveMembership = useArchiveMembership();
  // Reason, Notes and text attributes are held here and saved on blur AND
  // when the sheet closes. Saving on blur alone lost the text when the sheet
  // was closed with Escape or a click outside: the field unmounted before it
  // ever blurred.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(membership));
  // What has been sent to the server, so a blur followed by a close does not
  // save the same text twice.
  const saved = useRef<Draft>(draftFrom(membership));
  const stages = parseArray<Stage>(group.stages);
  const schema = parseObject<AttributeSchema>(group.attributes_schema);
  const values = parseObject<Record<string, string | number>>(membership?.attributes ?? {});
  if (!membership) return <Sheet open={open} onOpenChange={onOpenChange} />;

  const update = (updates: Parameters<typeof updateMembership.mutate>[0]) => updateMembership.mutate(updates, { onSuccess: () => showToast.success("Membership updated") });
  const updateField = (field: "status" | "priority", value: string | null) => update({ id: membership.id, groupId: group.id, personId: membership.contact_id, [field]: value });
  const attributeValue = (key: string, text: string) => (schema[key]?.type === "number" ? Number(text || 0) : text);
  // Saves every change not saved yet, in one update. `picked` is a select
  // attribute chosen right now (state updates land after this call). While
  // the sheet is open the draft is the truth for every attribute, so a save
  // made before the previous one has reloaded cannot put an old value back.
  const saveDraft = (picked?: Record<string, string>) => {
    const current: Draft = picked ? { ...draft, attributes: { ...draft.attributes, ...picked } } : draft;
    if (picked) setDraft(current);
    const updates: Omit<Parameters<typeof updateMembership.mutate>[0], "id" | "groupId" | "personId"> = {};
    if (current.reason !== saved.current.reason) updates.reason = current.reason || null;
    if (current.notes !== saved.current.notes) updates.notes = current.notes || null;
    const attributesChanged = Object.entries(current.attributes).some(([key, text]) => text !== saved.current.attributes[key]);
    if (attributesChanged) {
      const next: Record<string, string | number> = { ...values };
      Object.entries(current.attributes).forEach(([key, text]) => {
        if (key in schema && String(values[key] ?? "") !== text) next[key] = attributeValue(key, text);
      });
      updates.attributes = next as Json;
    }
    if (Object.keys(updates).length === 0) return;
    saved.current = { ...current, attributes: { ...current.attributes } };
    update({ id: membership.id, groupId: group.id, personId: membership.contact_id, ...updates });
  };
  const setDraftAttribute = (key: string, text: string) => setDraft((current) => ({ ...current, attributes: { ...current.attributes, [key]: text } }));
  const handleOpenChange = (next: boolean) => {
    if (!next) saveDraft();
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3 pr-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm text-primary">{initials(membership.contacts?.name)}</span>
            <span className="min-w-0"><span className="block truncate">{membership.contacts?.name || "Unknown person"}</span><Link to={`/dashboard/people/${membership.contact_id}`} className="text-sm font-normal text-muted-foreground hover:text-foreground">Open profile</Link></span>
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Status</Label><Select value={membership.status || ""} onValueChange={(value) => updateField("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Priority</Label><Select value={membership.priority} onValueChange={(value) => updateField("priority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label htmlFor="membership-reason">Reason</Label><Textarea id="membership-reason" value={draft.reason} onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))} onBlur={() => saveDraft()} /></div>
          <div className="space-y-2"><Label htmlFor="membership-notes">Notes</Label><Textarea id="membership-notes" value={draft.notes} onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))} onBlur={() => saveDraft()} className="min-h-24" /></div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Attributes</h3>
            {Object.entries(schema).length === 0 ? <p className="text-sm text-muted-foreground">No attributes configured.</p> : Object.entries(schema).map(([key, config]) => (
              <div key={key} className="space-y-2">
                <Label>{config.label}</Label>
                {config.type === "select" ? <Select value={draft.attributes[key] ?? ""} onValueChange={(value) => saveDraft({ [key]: value })}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{(config.options || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input aria-label={config.label} type={config.type === "number" ? "number" : "text"} min={config.min} max={config.max} value={draft.attributes[key] ?? ""} onChange={(e) => setDraftAttribute(key, e.target.value)} onBlur={() => saveDraft()} />}
              </div>
            ))}
          </div>
          <NextStepsSection group={group} membership={membership} />
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Source Notes</h3>
            {notes.length === 0 ? <p className="text-sm text-muted-foreground">No source notes.</p> : notes.map((note) => <Link key={note.id} to={`/dashboard/notes/${note.id}`} className="block rounded-md border p-3 text-sm hover:bg-accent">{note.title || "Untitled"}</Link>)}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => archiveMembership.mutate({ id: membership.id, groupId: group.id, personId: membership.contact_id }, { onSuccess: () => { showToast.success("Membership archived"); onOpenChange(false); } })}><Archive className="mr-2 h-4 w-4" /> Archive</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex-1"><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove from {group.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This membership, with its stage, attributes and notes, will be deleted. Archive keeps it instead. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => removeMembership.mutate({ id: membership.id, groupId: group.id, personId: membership.contact_id }, { onSuccess: () => { showToast.success("Removed from group"); onOpenChange(false); } })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
