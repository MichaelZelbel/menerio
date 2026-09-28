import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/claims";
import { NoteSearchInput } from "./NoteSearchInput";

const CUSTOM_ENTRY_VALUE = "__custom__";

export interface EntryFormData {
  label: string;
  value: string;
  linked_note_id: string | null;
  category_slug: string | null;
  /** "It changed" only: the day the new value became true. */
  valid_from?: string | null;
}

interface EntryFormProps {
  /**
   * add: a new fact (label + value).
   * changed: "It changed", a new value from a date; the old one becomes history.
   * fix: "Fix a mistake", the value is corrected in place.
   */
  mode?: "add" | "changed" | "fix";
  /** The fact being changed or fixed. */
  initial?: { label: string; value: string };
  categorySlug: string | null;
  suggestedLabels?: string[];
  existingLabels?: string[];
  onSave: (data: EntryFormData) => void;
  onCancel: () => void;
}

export function EntryForm({
  mode = "add",
  initial,
  categorySlug,
  suggestedLabels = [],
  existingLabels = [],
  onSave,
  onCancel,
}: EntryFormProps) {
  const editing = mode !== "add";
  // Filter out already-used labels (case-insensitive)
  const lowerExisting = existingLabels.map((l) => l.toLowerCase());
  const availableSuggestions = suggestedLabels.filter((s) => !lowerExisting.includes(s.toLowerCase()));

  const hasSuggestions = availableSuggestions.length > 0;
  const defaultSelection = editing ? initial?.label ?? "" : hasSuggestions ? availableSuggestions[0] : CUSTOM_ENTRY_VALUE;

  const [selectedOption, setSelectedOption] = useState(defaultSelection);
  const [customLabel, setCustomLabel] = useState(initial?.label ?? "");
  const [value, setValue] = useState(mode === "fix" ? initial?.value ?? "" : "");
  const [validFrom, setValidFrom] = useState(todayISO());
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);

  const isCustom = selectedOption === CUSTOM_ENTRY_VALUE;
  const resolvedLabel = editing ? initial?.label ?? "" : isCustom ? customLabel : selectedOption;

  // Reset the add form when the suggestions change or after a save.
  useEffect(() => {
    if (!editing) {
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
    if (mode === "changed" && !validFrom) return;
    onSave({
      label: resolvedLabel.trim(),
      value: value.trim(),
      linked_note_id: noteId,
      category_slug: categorySlug,
      valid_from: mode === "changed" ? validFrom : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      {editing ? (
        <p className="text-xs text-muted-foreground">
          {mode === "changed" ? (
            <>
              <span className="font-medium text-foreground">{initial?.label}</span> changed. "{initial?.value}" stays in history.
            </>
          ) : (
            <>
              Fix <span className="font-medium text-foreground">{initial?.label}</span>. The old words are replaced.
            </>
          )}
        </p>
      ) : hasSuggestions ? (
        <div className="space-y-2">
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
          {isCustom && (
            <Input
              placeholder="Enter a label..."
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
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
        placeholder={mode === "changed" ? "The new value..." : "Your answer..."}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-sm min-h-[60px]"
        rows={2}
        autoFocus={editing || (!isCustom && hasSuggestions)}
        aria-label={mode === "changed" ? "New value" : "Value"}
      />

      {mode === "changed" && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground" htmlFor="fact-changed-since">
            Since
          </Label>
          <Input
            id="fact-changed-since"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="h-8 text-sm w-44"
          />
        </div>
      )}

      {mode === "add" && (
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
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!resolvedLabel.trim() || !value.trim() || (mode === "changed" && !validFrom)}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
