import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showToast } from "@/lib/toast";
import { useAddMembership } from "@/hooks/useGroupMemberships";
import { useToggleFavoritePerson } from "@/hooks/usePeople";
import type { GroupLite } from "./peopleTreeBuild";

interface PeopleBulkBarProps {
  selectedIds: string[];
  groups: GroupLite[];
  onClear: () => void;
}

/**
 * Bulk action bar shown at the bottom of the People tree when rows are
 * multi-selected. Reuses the original page's bulk add-to-group logic (a group
 * picker + `Promise.allSettled` with 23505 dedupe) and adds a favorite action.
 */
export function PeopleBulkBar({ selectedIds, groups, onClear }: PeopleBulkBarProps) {
  const qc = useQueryClient();
  const addMembership = useAddMembership();
  const toggleFavorite = useToggleFavoritePerson();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState("");

  const addToGroup = async () => {
    if (!groupId || selectedIds.length === 0) return;
    const results = await Promise.allSettled(
      selectedIds.map((personId) => addMembership.mutateAsync({ groupId, personId })),
    );
    const added = results.filter((result) => result.status === "fulfilled").length;
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const alreadyMembers = rejected.filter((result) =>
      String(result.reason?.message || "").toLowerCase().includes("duplicate"),
    ).length;
    const errors = rejected.length - alreadyMembers;
    showToast.success(`${added} added, ${alreadyMembers} already members, ${errors} errors`);
    qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
    onClear();
    setOpen(false);
    setGroupId("");
  };

  const favoriteAll = () => {
    selectedIds.forEach((id) => toggleFavorite.mutate({ id, isFavorite: true }));
    onClear();
  };

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background px-3 py-2">
      <span className="text-xs font-medium">{selectedIds.length} selected</span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>Add to group</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={favoriteAll}>Favorite</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>Clear</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add selected people to group</DialogTitle>
            <DialogDescription>Choose a group for the {selectedIds.length} selected people.</DialogDescription>
          </DialogHeader>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={addToGroup} disabled={!groupId || addMembership.isPending}>
              {addMembership.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
