import { useMemo } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GroupStage } from "@/components/groups/PipelineColumn";

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stage";

const shortId = () => Math.random().toString(36).slice(2, 7);

function makeStageId(label: string, existing: GroupStage[]): string {
  const base = slugify(label || "stage");
  if (!existing.some((s) => s.id === base)) return base;
  return `${base}-${shortId()}`;
}

export function StagesEditor({
  stages,
  onChange,
  membershipCounts,
}: {
  stages: GroupStage[];
  onChange: (next: GroupStage[]) => void;
  membershipCounts?: Record<string, number>;
}) {
  const firstStageLabel = stages[0]?.label || "the first stage";
  const counts = useMemo(() => membershipCounts || {}, [membershipCounts]);

  const update = (index: number, patch: Partial<GroupStage>) => {
    const next = stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage));
    onChange(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number) => {
    if (stages.length <= 1) return;
    const removed = stages[index];
    const count = counts[removed.id] || 0;
    if (count > 0) {
      const target = index === 0 ? stages[1].label : stages[0].label;
      const ok = window.confirm(`${count} member${count === 1 ? "" : "s"} currently in "${removed.label}" will move to "${target}". Continue?`);
      if (!ok) return;
    }
    onChange(stages.filter((_, i) => i !== index));
  };

  const add = () => {
    const label = "New stage";
    onChange([...stages, { id: makeStageId(label, stages), label, color: "#94a3b8" }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Pipeline Stages</Label>
        <span className="text-xs text-muted-foreground">Rename, reorder, add, or remove stages. Members in a deleted stage move to {firstStageLabel}.</span>
      </div>
      <div className="space-y-2 rounded-md border border-border p-3">
        {stages.map((stage, index) => {
          const count = counts[stage.id] || 0;
          return (
            <div key={stage.id} className="flex items-center gap-2">
              <div className="flex flex-col">
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-3 w-3" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5" disabled={index === stages.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-3 w-3" /></Button>
              </div>
              <Input value={stage.label} onChange={(e) => update(index, { label: e.target.value })} placeholder="Stage label" className="flex-1" />
              <input type="color" value={stage.color || "#94a3b8"} onChange={(e) => update(index, { color: e.target.value })} className="h-9 w-10 cursor-pointer rounded border border-input bg-background" aria-label="Stage color" />
              <span className="w-16 text-right text-xs text-muted-foreground">{count} {count === 1 ? "member" : "members"}</span>
              <Button type="button" variant="ghost" size="icon" className="text-destructive" disabled={stages.length <= 1} onClick={() => remove(index)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={add} className="mt-2"><Plus className="mr-2 h-4 w-4" />Add stage</Button>
      </div>
    </div>
  );
}
