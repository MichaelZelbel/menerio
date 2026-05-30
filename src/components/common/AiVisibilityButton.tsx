import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useToggleAiVisibility,
  useToggleSensitivePerson,
  type AiKind,
} from "@/hooks/useAiVisibility";

import { AiFootprintDialog } from "@/components/common/AiFootprintDialog";

export type AiEntityKind = "person" | "note" | "moment" | "collection_item" | "action_item";

const kindToTable: Record<Exclude<AiEntityKind, "person">, AiKind> = {
  note: "notes",
  moment: "moments",
  collection_item: "collection_items",
  action_item: "action_items",
};

interface Props {
  kind: AiEntityKind;
  id: string;
  hidden: boolean;
  className?: string;
  /** Render as icon-only (no label). Defaults to false. */
  iconOnly?: boolean;
}

/**
 * Unified visibility toggle for any AI-touched entity.
 *  - Eye + "AI"     = visible to AI (Lexicon, People, Graph, AI Chat, MCP)
 *  - EyeOff + "Hidden" = hidden from all AI surfaces
 *
 * For `kind="person"` this flips `is_sensitive` (which also cascades to
 * linked notes/moments/actions). For all other kinds it flips
 * `ai_visibility` on the row itself.
 */
export function AiVisibilityButton({ kind, id, hidden, className, iconOnly = false }: Props) {
  const togglePerson = useToggleSensitivePerson();
  const toggleItem = useToggleAiVisibility(
    kind === "person" ? "contacts" : kindToTable[kind],
  );

  const [optimistic, setOptimistic] = useState(hidden);
  const [footprintOpen, setFootprintOpen] = useState(false);
  useEffect(() => setOptimistic(hidden), [hidden]);

  const pending = kind === "person" ? togglePerson.isPending : toggleItem.isPending;

  const onClick = () => {
    const next = !optimistic;
    setOptimistic(next);
    if (kind === "person") {
      togglePerson.mutate(
        { id, isSensitive: next },
        { onError: () => setOptimistic(hidden) },
      );
    } else {
      toggleItem.mutate(
        { id, visibility: next ? "hidden" : "visible" },
        {
          onError: () => setOptimistic(hidden),
          onSuccess: () => {
            if (next && kind === "note") setFootprintOpen(true);
          },
        },
      );
    }
  };

  const tooltip = optimistic
    ? kind === "person"
      ? "Hidden from AI. Linked notes & moments are hidden too. Click to make visible."
      : "Hidden from AI: excluded from Lexicon, People, Knowledge Graph, AI Chat and MCP. Local search still finds it. Click to make visible."
    : kind === "person"
      ? "Visible to AI. Click to hide this person and everything linked to them from all AI features."
      : "Visible to AI: used in Lexicon, People profiles, Knowledge Graph, AI Chat, and MCP clients. Click to hide.";

  const Icon = pending ? Loader2 : optimistic ? EyeOff : Eye;
  const label = optimistic ? "Hidden" : "AI";

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClick}
              disabled={pending}
              aria-pressed={optimistic}
              className={cn(
                "h-7 gap-1.5 px-2 text-xs font-normal",
                optimistic
                  ? "text-muted-foreground border-dashed"
                  : "text-foreground",
                className,
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
              {!iconOnly && <span>{label}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {kind === "note" && (
        <AiFootprintDialog
          noteId={id}
          open={footprintOpen}
          onOpenChange={setFootprintOpen}
        />
      )}
    </>
  );
}
