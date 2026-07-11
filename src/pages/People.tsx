import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Search, User, Users, X } from "lucide-react";

import { PeopleTree } from "@/components/people/PeopleTree";
import { PersonDetail } from "@/components/people/PersonDetail";
import { MergePersonDialog } from "@/components/people/MergePersonDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGroups, useCreateGroup, useUpdateGroup, useArchiveGroup } from "@/hooks/useGroups";
import { useAllMemberships, useAddMembership, useRemoveMembership } from "@/hooks/useGroupMemberships";
import {
  usePeople,
  useCreatePerson,
  useDeletePerson,
  useToggleFavoritePerson,
} from "@/hooks/usePeople";

export default function People() {
  const { id: routePersonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  // Selection is URL-driven so /dashboard/people/:id deep-links work and the
  // browser back button behaves. We never keep a separate copy that could
  // drift from the URL.
  const selectedPersonId = routePersonId ?? null;
  const openPerson = (personId: string) => navigate(`/dashboard/people/${personId}`);
  const closePerson = () => navigate("/dashboard/people");

  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [mergeTreeId, setMergeTreeId] = useState<string | null>(null);

  // Consume deep-link params from other surfaces (global "+", command palette,
  // relationships panel). ?contact=<id> normalizes to the path form; ?action=create
  // and ?new=1 open the create dialog. Params are stripped after handling.
  useEffect(() => {
    const contact = searchParams.get("contact");
    if (contact) {
      navigate(`/dashboard/people/${contact}`, { replace: true });
      return;
    }
    if (searchParams.get("action") === "create" || searchParams.get("new")) {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, navigate, setSearchParams]);

  // ── Queries ──
  const { data: people = [] } = usePeople();
  const { data: groups = [] } = useGroups();
  const { data: memberships = [] } = useAllMemberships();

  const selectedPerson = people.find((p) => p.id === selectedPersonId);

  // ── Mutations ──
  const createPerson = useCreatePerson();
  const toggleFavorite = useToggleFavoritePerson();
  const deletePerson = useDeletePerson();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const archiveGroup = useArchiveGroup();
  const addMembership = useAddMembership();
  const removeMembership = useRemoveMembership();

  const submitCreatePerson = () => {
    if (!createName.trim()) return;
    createPerson.mutate(createName, {
      onSuccess: () => {
        setCreateOpen(false);
        setCreateName("");
      },
    });
  };

  // ── Tree callbacks ──
  const handleCreateGroup = (parentGroupId: string | null) => {
    const name = window.prompt(parentGroupId ? "New subgroup name" : "New group name");
    if (!name || !name.trim()) return;
    // Minimal one-step create: no template picker. Safe defaults for required
    // fields; empty stages make it a stage-less "list" group.
    createGroup.mutate(
      { name: name.trim(), type: "other", stages: [], parent_group_id: parentGroupId } as any,
      { onSuccess: () => showToast.success("Group created") },
    );
  };

  const handleRenameGroup = (groupId: string, currentName: string) => {
    const name = window.prompt("Rename group", currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    updateGroup.mutate({ id: groupId, name: trimmed }, { onSuccess: () => showToast.success("Group renamed") });
  };

  const handleArchiveGroup = (groupId: string) => {
    archiveGroup.mutate(groupId, { onSuccess: () => showToast.success("Group archived") });
  };

  const handleReparentGroup = (groupId: string, parentGroupId: string | null) => {
    updateGroup.mutate(
      { id: groupId, parent_group_id: parentGroupId } as any,
      { onSuccess: () => showToast.success(parentGroupId ? "Group moved" : "Group moved to top level") },
    );
  };

  const handleAddToGroup = (personId: string, groupId: string) => {
    // The hook translates a 23505 duplicate into an "Already a member" toast.
    addMembership.mutate({ groupId, personId });
  };

  const handleRemoveFromGroup = (personId: string, groupId: string) => {
    const membership = memberships.find((m) => m.group_id === groupId && m.contact_id === personId);
    if (!membership) return;
    removeMembership.mutate(
      { id: membership.id, groupId, personId },
      { onSuccess: () => showToast.success("Removed from group") },
    );
  };

  const handleCreatePersonInGroup = async (groupId: string | null) => {
    const name = window.prompt("New person's name");
    if (!name || !name.trim()) return;
    try {
      const person = await createPerson.mutateAsync(name.trim());
      if (groupId && person?.id) addMembership.mutate({ groupId, personId: person.id });
    } catch {
      /* handled by the hook's onError */
    }
  };

  const handleDeletePerson = (personId: string) => {
    deletePerson.mutate(personId, {
      onSuccess: () => {
        if (personId === selectedPersonId) closePerson();
      },
    });
  };

  const mergeSource = mergeTreeId ? people.find((p) => p.id === mergeTreeId) ?? null : null;

  return (
    <div className="flex h-[calc(100dvh-56px)] overflow-hidden">
      <SEOHead title="People — Menerio" noIndex />

      {/* Left panel — tree + search */}
      <div
        className={cn(
          "shrink-0 flex-col border-r border-border bg-background min-w-0",
          isMobile ? "w-full" : "w-72",
          isMobile && selectedPersonId ? "hidden" : "flex",
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
          <div className="flex h-8 flex-col justify-center px-2 text-sm font-semibold leading-tight">
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4" /> People
            </div>
            <span className="text-[10px] font-normal text-muted-foreground">{people.length}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            title="Add person"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="shrink-0 border-b border-border px-2 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchQuery("");
              }}
              placeholder="Search people..."
              className="h-8 pl-8 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <PeopleTree
          people={people}
          groups={groups}
          memberships={memberships}
          selectedPersonId={selectedPersonId}
          searchQuery={searchQuery}
          onSelectPerson={openPerson}
          onToggleFavorite={(id, isFavorite) => toggleFavorite.mutate({ id, isFavorite })}
          onCreateGroup={handleCreateGroup}
          onRenameGroup={handleRenameGroup}
          onArchiveGroup={handleArchiveGroup}
          onReparentGroup={handleReparentGroup}
          onAddToGroup={handleAddToGroup}
          onRemoveFromGroup={handleRemoveFromGroup}
          onCreatePerson={handleCreatePersonInGroup}
          onMergePerson={(id) => setMergeTreeId(id)}
          onDeletePerson={handleDeletePerson}
        />
      </div>

      {/* Right panel — detail */}
      <div className={cn("min-w-0 flex-1 flex-col", isMobile && !selectedPersonId ? "hidden" : "flex")}>
        {selectedPerson ? (
          <PersonDetail key={selectedPerson.id} person={selectedPerson} people={people} onClose={closePerson} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Select a person</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Choose someone from the list, or add a new person to get started.
            </p>
          </div>
        )}
      </div>

      {/* Add-person dialog (also opened by the ?action=create deep link) */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>Create a new contact for your personal knowledge graph.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="person-name">Name</Label>
            <Input
              id="person-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && createName.trim()) submitCreatePerson();
              }}
              placeholder="Ada Lovelace"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreatePerson} disabled={!createName.trim() || createPerson.isPending}>
              {createPerson.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge initiated from a tree row's context menu */}
      {mergeSource && (
        <MergePersonDialog
          open={!!mergeSource}
          onOpenChange={(open) => {
            if (!open) setMergeTreeId(null);
          }}
          sourcePerson={mergeSource}
          allPeople={people}
          prefillTargetId={null}
          onMergeComplete={() => {
            const wasSelected = mergeSource.id === selectedPersonId;
            setMergeTreeId(null);
            if (wasSelected) closePerson();
          }}
        />
      )}
    </div>
  );
}
