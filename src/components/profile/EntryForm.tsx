import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { NoteSearchInput } from "./NoteSearchInput";
import type { ProfileEntry } from "@/hooks/useProfile";

interface EntryFormProps {
  initial?: ProfileEntry;
  categoryId: string;
  onSave: (data: { label: string; value: string; linked_note_id: string | null; category_id: string; id?: string }) => void;
  onCancel: () => void;
}

export function EntryForm({ initial, categoryId, onSave, onCancel }: EntryFormProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [noteId, setNoteId] = useState<string | null>(initial?.linked_note_id ?? null);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !value.trim()) return;
    onSave({ label: label.trim(), value: value.trim(), linked_note_id: noteId, category_id: categoryId, id: initial?.id });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <Input
        placeholder="e.g., Favorite book"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="text-sm"
      />
      <Textarea
        placeholder="Your answer..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-sm min-h-[60px]"
        rows={2}
      />
      <div>
        <p className="text-xs text-muted-foreground mb-1">Link a note (optional)</p>
        <NoteSearchInput
          selectedNoteId={noteId}
          selectedNoteTitle={noteTitle ?? undefined}
          onSelect={(id, title) => {
            setNoteId(id);
            setNoteTitle(title);
          }}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!label.trim() || !value.trim()}>Save</Button>
      </div>
    </form>
  );
}
