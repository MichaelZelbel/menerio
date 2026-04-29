import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GroupMembershipWithPerson } from "@/hooks/useGroupMemberships";
import { initials, relativeDate } from "@/lib/group-utils";

export type GroupStage = { id: string; label: string; color?: string };

function MemberCard({ membership, onOpen }: { membership: GroupMembershipWithPerson; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: membership.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className="w-full rounded-lg border bg-background p-3 text-left shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none"
    >
      <div className="flex items-start gap-2">
        <span {...listeners} {...attributes} className="mt-1 cursor-grab text-muted-foreground" onClick={(e) => e.stopPropagation()}><GripVertical className="h-4 w-4" /></span>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(membership.contacts?.name)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{membership.contacts?.name || "Unknown person"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={membership.priority === "urgent" ? "destructive" : "secondary"} className="text-[10px] capitalize">{membership.priority}</Badge>
            <span className="text-xs text-muted-foreground">{relativeDate(membership.last_movement_at)}</span>
          </div>
        </div>
      </div>
      {isDragging && <span className="sr-only">Dragging</span>}
    </button>
  );
}

export function PipelineColumn({ stage, memberships, onOpen }: { stage: GroupStage; memberships: GroupMembershipWithPerson[]; onOpen: (m: GroupMembershipWithPerson) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-muted/30 p-3 transition-colors ${isOver ? "bg-accent" : ""}`}>
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-sm font-medium">{stage.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">{memberships.length}</Badge>
      </div>
      <div className="min-h-[160px] space-y-2">
        {memberships.map((membership) => <MemberCard key={membership.id} membership={membership} onOpen={() => onOpen(membership)} />)}
      </div>
    </div>
  );
}
