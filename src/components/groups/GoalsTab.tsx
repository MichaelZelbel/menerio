import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useUpdateGroup } from "@/hooks/useGroups";
import { showToast } from "@/lib/toast";
import { parseArray, pretty } from "@/lib/group-utils";

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type SuccessCriterion = { label: string; target: number; current?: number; kind: "manual" | "interaction_count" | "action_item_count"; period_days?: number };

export function GoalsTab({ group }: { group: ContactGroup }) {
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
        const { count, error } = await supabase.from("contact_interactions").select("id", { count: "exact", head: true }).eq("group_id", group.id).gte("interaction_date", since.toISOString().slice(0, 10));
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
      {criteria.length === 0 ? <Card><CardContent className="flex flex-col items-center justify-center py-12 text-center"><Target className="mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No goals yet.</p><p className="mt-1 text-sm text-muted-foreground">Add a goal to track this group’s mission.</p></CardContent></Card> : criteria.map((criterion, index) => {
        const current = criterion.kind === "interaction_count" ? interactionCounts[index] ?? 0 : Number(criterion.current || 0);
        const target = Math.max(1, Number(criterion.target || 1));
        return <Card key={`${criterion.label}-${index}`}><CardContent className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{criterion.label}</p><p className="text-sm text-muted-foreground">{current}/{target} · {pretty(criterion.kind)}{criterion.kind === "interaction_count" ? ` · last ${criterion.period_days || 30} days` : ""}</p></div><Button variant="ghost" size="icon" onClick={() => openEdit(index)}><Pencil className="h-4 w-4" /></Button></div><Progress value={Math.min(100, Math.round((current / target) * 100))} />{criterion.kind === "manual" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setManualValue(index, current + 1)}><Plus className="mr-1 h-4 w-4" />1</Button><Button size="sm" variant="outline" onClick={() => setManualValue(index, current - 1)}><Minus className="mr-1 h-4 w-4" />1</Button><Button size="sm" variant="ghost" onClick={() => openEdit(index)}>Set value</Button></div>}</CardContent></Card>;
      })}
      <Dialog open={editingIndex !== null} onOpenChange={(open) => !open && setEditingIndex(null)}><DialogContent><DialogHeader><DialogTitle>{editingIndex === "new" ? "Add Goal" : "Edit Goal"}</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Label</Label><Input value={form.label} onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Target</Label><Input type="number" min={1} value={form.target} onChange={(e) => setForm((current) => ({ ...current, target: Number(e.target.value || 1) }))} /></div><div className="space-y-2"><Label>Current</Label><Input type="number" min={0} value={form.current || 0} onChange={(e) => setForm((current) => ({ ...current, current: Number(e.target.value || 0) }))} disabled={form.kind === "interaction_count"} /></div></div><div className="space-y-2"><Label>Kind</Label><Select value={form.kind} onValueChange={(kind) => setForm((current) => ({ ...current, kind: kind as SuccessCriterion["kind"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="interaction_count">Interaction Count</SelectItem><SelectItem value="action_item_count">Action Item Count</SelectItem></SelectContent></Select></div>{form.kind === "interaction_count" && <div className="space-y-2"><Label>Period days</Label><Input type="number" min={1} value={form.period_days || 30} onChange={(e) => setForm((current) => ({ ...current, period_days: Number(e.target.value || 30) }))} /></div>}</div><DialogFooter className="gap-2 sm:justify-between">{editingIndex !== "new" && <Button variant="destructive" onClick={deleteGoal}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}<Button onClick={submit} disabled={!form.label.trim() || updateGroup.isPending}>{updateGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
