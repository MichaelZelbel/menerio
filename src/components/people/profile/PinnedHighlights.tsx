import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const visible = expanded ? pinned : pinned.slice(0, MAX_VISIBLE);
  const hiddenCount = pinned.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((entry) => (
        <div
          key={entry.id}
          className="group/chip inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 text-xs"
        >
          <span className="text-muted-foreground">{entry.label}</span>
          <span className="font-medium">{entry.value}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Unpin ${entry.label}`}
            className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-destructive"
            onClick={() => onTogglePin(entry)}
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
