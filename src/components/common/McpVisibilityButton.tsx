import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useToggleMcpVisibility,
  useToggleSensitivePerson,
  type McpKind,
} from "@/hooks/useMcpVisibility";

export type McpEntityKind = "person" | "note" | "moment" | "collection_item" | "action_item";

interface Props {
  kind: McpEntityKind;
  id: string;
  hidden: boolean;
  className?: string;
  /** Render as icon-only (no label). Defaults to false. */
  iconOnly?: boolean;
}

const kindToTable: Record<Exclude<McpEntityKind, "person">, McpKind> = {
  note: "notes",
  moment: "moments",
  collection_item: "collection_items",
  action_item: "action_items",
};

/**
 * Unified visibility toggle for any MCP-exposed entity.
 *  - Eye + "MCP"   = visible to MCP / AI clients
 *  - EyeOff + "Hidden" = hidden from MCP / AI clients
 *
 * For `kind="person"` this flips `is_sensitive` (which also cascades to
 * linked notes/moments/actions). For all other kinds it flips
 * `mcp_visibility` on the row itself.
 *
 * Keeps a local optimistic state so the label flips instantly in both
 * directions, regardless of how fast the query refetch lands.
 */
export function McpVisibilityButton({ kind, id, hidden, className, iconOnly = false }: Props) {
  const togglePerson = useToggleSensitivePerson();
  const toggleItem = useToggleMcpVisibility(
    kind === "person" ? "contacts" : kindToTable[kind],
  );

  const [optimistic, setOptimistic] = useState(hidden);
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
        { onError: () => setOptimistic(hidden) },
      );
    }
  };

  const tooltip = optimistic
    ? kind === "person"
      ? "Hidden from MCP clients. Linked notes & moments are hidden too. Click to make visible."
      : "Hidden from MCP clients. Click to make visible."
    : kind === "person"
      ? "Visible to MCP clients. Click to hide this person and everything linked to them."
      : "Visible to MCP clients (ChatGPT, Claude, …). Click to hide.";

  const Icon = pending ? Loader2 : optimistic ? EyeOff : Eye;
  const label = optimistic ? "Hidden" : "MCP";

  return (
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
  );
}
