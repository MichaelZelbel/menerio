import { useState } from "react";
import { Plus, Pencil, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScopeBadge, SCOPE_OPTIONS } from "./ScopeBadge";
import type { AgentInstruction } from "@/hooks/useProfile";

const EXAMPLE_INSTRUCTIONS = [
  "Always address me as Mike, never Michael",
  "I prefer bullet points over long paragraphs",
  "Never suggest meditation — I find it unhelpful",
  "When helping with code, use TypeScript and functional patterns",
  "Speak to me in German unless I write in English",
  "Don't sugarcoat feedback — I prefer direct honesty",
  "When discussing health topics, remember I have Type 1 diabetes",
];

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

  const InlineForm = ({ placeholder }: { placeholder?: string }) => (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
      <Textarea
        placeholder={placeholder ?? "e.g., Always address me informally"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="text-sm"
        autoFocus
      />
      <div className="flex items-center gap-2 flex-wrap">
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
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <MessageSquare className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Agent Instructions</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Write direct instructions for AI agents that access your profile. These are injected into the agent's context alongside your profile data. Think of them as your personal rules for how AI should work with you.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Add form at the top */}
        {adding ? (
          <InlineForm />
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setAdding(true); setEditingId(null); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add instruction
          </Button>
        )}

        {/* Empty state with examples */}
        {instructions.length === 0 && !adding && (
          <div className="rounded-lg border border-dashed border-border p-5 space-y-3">
            <p className="text-sm text-muted-foreground font-medium">Example instructions to get you started:</p>
            <ul className="space-y-2">
              {EXAMPLE_INSTRUCTIONS.map((ex, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground/40 mt-0.5">•</span>
                  <button
                    className="text-sm text-muted-foreground/60 italic text-left hover:text-foreground transition-colors"
                    onClick={() => {
                      setText(ex);
                      setAdding(true);
                    }}
                  >
                    "{ex}"
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground/50">Click any example to use it as a starting point.</p>
          </div>
        )}

        {/* Instruction cards */}
        {instructions.map((inst) =>
          editingId === inst.id ? (
            <InlineForm key={inst.id} />
          ) : (
            <div
              key={inst.id}
              className="flex items-start gap-3 rounded-lg border border-border p-4 group hover:bg-accent/20 transition-colors"
            >
              <Switch
                checked={inst.is_active}
                onCheckedChange={(checked) => onSave({ id: inst.id, is_active: checked })}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!inst.is_active ? "text-muted-foreground line-through" : ""}`}>
                  {inst.instruction}
                </p>
                <ScopeBadge scope={inst.applies_to} className="mt-1.5" />
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
      </CardContent>
    </Card>
  );
}
