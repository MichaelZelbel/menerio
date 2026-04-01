import { useState } from "react";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScopeBadge, SCOPE_OPTIONS } from "./ScopeBadge";
import type { AgentInstruction } from "@/hooks/useProfile";

interface Props {
  instructions: AgentInstruction[];
  onSave: (data: Partial<AgentInstruction> & { id?: string }) => void;
  onDelete: (id: string) => void;
}

export function AgentInstructionsTab({ instructions, onSave, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");

  const startEdit = (inst: AgentInstruction) => {
    setEditingId(inst.id);
    setText(inst.instruction);
    setScope(inst.applies_to);
    setAdding(false);
  };

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({ id: editingId ?? undefined, instruction: text.trim(), applies_to: scope });
    setEditingId(null);
    setAdding(false);
    setText("");
    setScope("all");
  };

  const cancel = () => {
    setEditingId(null);
    setAdding(false);
    setText("");
    setScope("all");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Agent Instructions</CardTitle>
        <CardDescription>
          Explicit directives for AI agents. E.g. "Always address me informally" or "I prefer concise answers."
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {instructions.map((inst) =>
          editingId === inst.id ? (
            <div key={inst.id} className="space-y-2 rounded-lg border border-border p-4 bg-muted/30">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-sm" />
              <div className="flex items-center gap-2">
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger className="w-48 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>Save</Button>
              </div>
            </div>
          ) : (
            <div key={inst.id} className="flex items-start gap-3 rounded-lg border border-border p-4 group hover:bg-accent/20 transition-colors">
              <button
                className="shrink-0 mt-0.5"
                onClick={() => onSave({ id: inst.id, is_active: !inst.is_active })}
              >
                {inst.is_active ? (
                  <ToggleRight className="h-5 w-5 text-primary" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!inst.is_active ? "text-muted-foreground line-through" : ""}`}>
                  {inst.instruction}
                </p>
                <ScopeBadge scope={inst.applies_to} className="mt-1" />
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(inst)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(inst.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )
        )}

        {adding ? (
          <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/30">
            <Textarea
              placeholder="e.g., Always address me informally"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="w-48 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={!text.trim()}>Save</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setAdding(true); setEditingId(null); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add instruction
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
