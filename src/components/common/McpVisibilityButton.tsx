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
 * Unified visibility toggle for any MyCö-exposed entity.
 *  - Eye + "MyCö"  = visible to MCP / AI clients
 *  - EyeOff + "Hidden" = hidden from MCP / AI clients
 *
 * For `kind="person"` this flips `is_sensitive` (which also cascades to
 * linked notes/moments/actions). For all other kinds it flips
 * `mcp_visibility` on the row itself.
 */
export function McpVisibilityButton({ kind, id, hidden, className, iconOnly = false }: Props) {
  const togglePerson = useToggleSensitivePerson();
  const toggleItem = useToggleMcpVisibility(
    kind === "person" ? "contacts" : kindToTable[kind],
  );

  const pending = kind === "person" ? togglePerson.isPending : toggleItem.isPending;

  const onClick = () => {
    if (kind === "person") {
      togglePerson.mutate({ id, isSensitive: !hidden });
    } else {
      toggleItem.mutate({ id, visibility: hidden ? "visible" : "hidden" });
    }
  };

  const tooltip = hidden
    ? kind === "person"
      ? "Hidden from MyCö. Linked notes & moments are hidden too. Click to make visible."
      : "Hidden from MyCö (ChatGPT, Claude, …). Click to make visible."
    : kind === "person"
      ? "Visible via MyCö. Click to hide this person and everything linked to them."
      : "Visible via MyCö (ChatGPT, Claude, …). Click to hide.";

  const Icon = pending ? Loader2 : hidden ? EyeOff : Eye;
  const label = hidden ? "Hidden" : "MyCö";

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
            aria-pressed={hidden}
            className={cn(
              "h-7 gap-1.5 px-2 text-xs font-normal",
              hidden
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
