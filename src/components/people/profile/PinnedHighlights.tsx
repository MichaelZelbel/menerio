import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayLabel, splitProfileValues } from "@/lib/profile-list-labels";
import type { ContactProfileEntry } from "@/hooks/useContactProfile";

const MAX_VISIBLE = 7;

interface PinnedHighlightsProps {
  entries: ContactProfileEntry[];
  onTogglePin: (entry: ContactProfileEntry) => void;
}

/**
 * Compact chip strip for pinned facts at the top of the profile. Renders
 * nothing when there are no pinned entries. Shows at most MAX_VISIBLE chips
 * plus a "+N" expander for the rest.
 */
export function PinnedHighlights({ entries, onTogglePin }: PinnedHighlightsProps) {
  const [expanded, setExpanded] = useState(false);
  const pinned = entries.filter((e) => e.is_pinned);

  if (pinned.length === 0) return null;

  // One chip per VALUE, not per row: a comma-packed multi-value fact used to
  // render as a single unreadable chip. Labels are canonicalized so pinned
  // chips match the label shown in the section below.
  const chips = pinned.flatMap((entry) =>
    splitProfileValues(entry.label, entry.value).map((value, i) => ({
      key: `${entry.id}-${i}`,
      entry,
      label: displayLabel(entry.label),
      value,
    })),
  );
  const visible = expanded ? chips : chips.slice(0, MAX_VISIBLE);
  const hiddenCount = chips.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((chip) => (
        <div
          key={chip.key}
          className="group/chip inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 text-xs"
        >
          <span className="text-muted-foreground">{chip.label}</span>
          <span className="font-medium">{chip.value}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Unpin ${chip.label}`}
            className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-destructive"
            onClick={() => onTogglePin(chip.entry)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          +{hiddenCount}
        </button>
      )}
    </div>
  );
}
