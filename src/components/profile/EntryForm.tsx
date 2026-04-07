import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NoteSearchInput } from "./NoteSearchInput";
import type { ProfileEntry } from "@/hooks/useProfile";

const CUSTOM_ENTRY_VALUE = "__custom__";

interface EntryFormProps {
  initial?: ProfileEntry;
  categoryId: string;
  suggestedLabels?: string[];
  existingLabels?: string[];
  onSave: (data: { label: string; value: string; linked_note_id: string | null; category_id: string; id?: string }) => void;
  onCancel: () => void;
}

export function EntryForm({ initial, categoryId, suggestedLabels = [], existingLabels = [], onSave, onCancel }: EntryFormProps) {
  // Filter out already-used labels (case-insensitive)
  const lowerExisting = existingLabels.map((l) => l.toLowerCase());
  const availableSuggestions = suggestedLabels.filter(
    (s) => !lowerExisting.includes(s.toLowerCase())
  );

  const hasSuggestions = availableSuggestions.length > 0;
  const defaultSelection = initial ? initial.label : hasSuggestions ? availableSuggestions[0] : CUSTOM_ENTRY_VALUE;

  const [selectedOption, setSelectedOption] = useState(defaultSelection);
  const [customLabel, setCustomLabel] = useState(initial?.label ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [noteId, setNoteId] = useState<string | null>(initial?.linked_note_id ?? null);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);

  const isCustom = selectedOption === CUSTOM_ENTRY_VALUE;
  const resolvedLabel = isCustom ? customLabel : selectedOption;

  // Reset form when category changes or after save
  useEffect(() => {
    if (!initial) {
      const next = hasSuggestions ? availableSuggestions[0] : CUSTOM_ENTRY_VALUE;
      setSelectedOption(next);
      setCustomLabel("");
      setValue("");
      setNoteId(null);
      setNoteTitle(null);
    }
  }, [availableSuggestions.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedLabel.trim() || !value.trim()) return;
    onSave({
      label: resolvedLabel.trim(),
      value: value.trim(),
      linked_note_id: noteId,
      category_id: categoryId,
      id: initial?.id,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      {/* Label selection */}
      {hasSuggestions || initial ? (
        <div className="space-y-2">
          {!initial && (
            <Select value={selectedOption} onValueChange={setSelectedOption}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="What would you like to add?" />
              </SelectTrigger>
              <SelectContent>
                {availableSuggestions.map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_ENTRY_VALUE}>✏️ Custom entry</SelectItem>
              </SelectContent>
            </Select>
          )}
          {(isCustom || initial) && (
            <Input
              placeholder="Enter a label..."
              value={isCustom ? customLabel : initial?.label ?? ""}
              onChange={(e) => {
                if (isCustom) setCustomLabel(e.target.value);
              }}
              readOnly={!!initial}
              className="text-sm"
            />
          )}
        </div>
      ) : (
        <Input
          placeholder="e.g., Favorite book"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          className="text-sm"
        />
      )}

      <Textarea
        placeholder="Your answer..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-sm min-h-[60px]"
        rows={2}
        autoFocus={!isCustom && hasSuggestions}
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
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!resolvedLabel.trim() || !value.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
