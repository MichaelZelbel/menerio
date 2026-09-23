import { useState } from "react";
import { Plus, Pencil, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

interface InlineFormProps {
  placeholder?: string;
  text: string;
  scope: string;
  onTextChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

// Module scope on purpose. Defined inside the tab's render, this was a new
// component type on every keystroke, so React unmounted and remounted the
// textarea each time: the caret jumped to the end, undo history vanished and
// an open scope picker snapped shut.
function InlineForm({ placeholder, text, scope, onTextChange, onScopeChange, onCancel, onSave }: InlineFormProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
      <Textarea
        placeholder={placeholder ?? "e.g., Always address me informally"}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={2}
        className="text-sm"
        autoFocus
      />
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={scope} onValueChange={onScopeChange}>
          <SelectTrigger className="w-48 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={!text.trim()}>Save</Button>
      </div>
    </div>
  );
}

export function AgentInstructionsTab({ instructions, onSave, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [pendingDelete, setPendingDelete] = useState<AgentInstruction | null>(null);

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

  const formProps = {
    text,
    scope,
    onTextChange: setText,
    onScopeChange: setScope,
    onCancel: cancel,
    onSave: handleSave,
  };

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
          <InlineForm {...formProps} />
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
            <InlineForm key={inst.id} {...formProps} />
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
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity shrink-0">
                <Button aria-label="Edit instruction" variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(inst)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete instruction" onClick={() => setPendingDelete(inst)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )
        )}
      </CardContent>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this instruction?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.instruction}" will no longer reach your AI tools. To pause it instead, use the switch.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
