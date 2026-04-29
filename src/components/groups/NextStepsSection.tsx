import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Loader2, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { GroupMembershipWithPerson } from "@/hooks/useGroupMemberships";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type ActionItem = Database["public"]["Tables"]["action_items"]["Row"] & { metadata?: Record<string, string> | null };
type NextStepSuggestion = { title: string; due_date_offset_days: number; priority: string; reasoning: string };

function formatDateInput(date: Date | undefined) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function NextStepsSection({ group, membership }: { group: ContactGroup; membership: GroupMembershipWithPerson }) {
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
        metadata: { group_membership_id: membership.id, group_id: group.id, person_id: membership.person_id },
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
            <DialogTrigger asChild><Button variant="outline" size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Next Step</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Next Step</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} placeholder="Follow up about the proposal" /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Due date</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dueDate && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{dueDate ? dueDate.toLocaleDateString() : "Pick a date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus /></PopoverContent></Popover></div>
                  <div className="space-y-2"><Label>Priority</Label><Select value={form.priority} onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((priority) => <SelectItem key={priority} value={priority} className="capitalize">{priority}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} className="min-h-24" /></div>
              </div>
              <DialogFooter><Button onClick={() => createNextStep.mutate()} disabled={!form.title.trim() || createNextStep.isPending}>{createNextStep.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="min-h-6">
        {isLoading ? <div className="flex h-6 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading next steps...</div> : nextSteps.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">No next steps yet.</p> : (
          <div className="space-y-2">{nextSteps.map((item) => <button key={item.id} type="button" onClick={() => navigate("/dashboard/actions")} className="block w-full rounded-md border p-3 text-left text-sm hover:bg-accent"><span className="font-medium">{item.content.split("\n")[0]}</span><span className="mt-2 flex flex-wrap gap-2"><Badge variant="secondary" className="text-[10px] capitalize">{item.status}</Badge><Badge variant="outline" className="text-[10px] capitalize">{item.priority}</Badge>{item.due_date && <Badge variant="outline" className="text-[10px]">{new Date(item.due_date).toLocaleDateString()}</Badge>}</span></button>)}</div>
        )}
      </div>
    </div>
  );
}
