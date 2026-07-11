import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  Users,
  User,
  ArrowLeft,
  Loader2,
  Trash2,
  X,
  Star,
  Merge,
} from "lucide-react";

import { ContactProfileTab } from "@/components/people/ContactProfileTab";
import { MergePersonDialog } from "@/components/people/MergePersonDialog";
import { DuplicateHints } from "@/components/people/DuplicateHints";
import { ConversationTab } from "@/components/people/ConversationTab";
import { PersonTimeline } from "@/components/people/PersonTimeline";
import { PersonDocuments } from "@/components/people/PersonDocuments";
import { PersonGroupsTab } from "@/components/people/PersonGroupsTab";
import { useGroups } from "@/hooks/useGroups";
import { useAddMembership, useGroupMemberships } from "@/hooks/useGroupMemberships";
import { AiVisibilityButton } from "@/components/common/AiVisibilityButton";
import {
  usePeople,
  useCreatePerson,
  useUpdatePerson,
  useDeletePerson,
  useToggleFavoritePerson,
  useTouchPersonViewed,
  Person,
} from "@/hooks/usePeople";

export default function People() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { id: routePersonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Selection is URL-driven so /dashboard/people/:id deep-links work and the
  // browser back button behaves. Callers navigate here; we never keep a
  // separate state copy that could drift from the URL.
  const selectedPersonId = routePersonId ?? null;
  const openPerson = (personId: string) => navigate(`/dashboard/people/${personId}`);
  const closePerson = () => navigate("/dashboard/people");
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePrefillId, setMergePrefillId] = useState<string | null>(null);
  // Inline editing state for detail view
  const [editingAliases, setEditingAliases] = useState<string[] | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [activePersonTab, setActivePersonTab] = useState("profile");
  const [conversationContext, setConversationContext] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkGroupId, setBulkGroupId] = useState("");
  const addMembership = useAddMembership();

  // Consume deep-link params from other surfaces (global "+", command palette,
  // relationships panel). ?contact=<id> normalizes to the path form; ?action=create
  // and ?new=1 open the create dialog. Params are stripped after handling so a
  // refresh doesn't re-fire and re-navigating the same URL re-triggers.
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
  const { data: people = [], isLoading } = usePeople();

  const selectedPerson = people.find((p) => p.id === selectedPersonId);
  const toggleFavorite = useToggleFavoritePerson();
  const touchPersonViewed = useTouchPersonViewed();
  const { data: groups = [] } = useGroups();
  const { data: groupFilterMemberships = [] } = useGroupMemberships(groupFilter === "all" ? null : groupFilter);

  // Record a view whenever the detail pane switches to a different person
  // (throttled inside the hook — skips if already touched within 5 minutes).
  // Keyed on the LOADED row's id, not the URL param: on a fresh page load the
  // URL id exists before the contacts query resolves, and touching then would
  // read an empty cache and bypass the throttle on every reload.
  const loadedPersonId = selectedPerson?.id ?? null;
  useEffect(() => {
    if (loadedPersonId) touchPersonViewed.mutate(loadedPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedPersonId]);

  // Related notes (notes mentioning this person by name or alias)
  const { data: relatedNotes = [] } = useQuery({
    queryKey: ["contact_notes", selectedPerson?.name, selectedPerson?.aliases],
    enabled: !!selectedPerson,
    queryFn: async () => {
      // Search by canonical name
      const names = [selectedPerson!.name, ...(selectedPerson!.aliases || [])];
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, created_at, metadata")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      // Filter client-side: notes whose metadata.people array contains any of the names
      return (data || []).filter((note: any) => {
        const people = note.metadata?.people as string[] | undefined;
        if (!people || !Array.isArray(people)) return false;
        return names.some((n) => people.some((p) => p.toLowerCase() === n.toLowerCase()));
      });
    },
  });

  // ── Mutations ──
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();
  const deletePerson = useDeletePerson();

  // Dialog-local state reset lives here (not in the hook) since the hook is
  // shared across pages that don't have a create dialog to close.
  const submitCreatePerson = () => {
    if (!createName.trim()) return;
    createPerson.mutate(createName, {
      onSuccess: () => {
        setCreateOpen(false);
        setCreateName("");
      },
    });
  };

  // ── Filtered list ──
  const filtered = people.filter((p) => {
    if (groupFilter !== "all" && !groupFilterMemberships.some((membership) => membership.contact_id === p.id)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.aliases || []).some((a) => a.toLowerCase().includes(q))
    );
  });

  const selectedSet = useMemo(() => new Set(selectedPeople), [selectedPeople]);
  const toggleSelected = (personId: string) => {
    setSelectedPeople((current) => current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]);
  };
  const clearSelection = () => setSelectedPeople([]);
  const bulkAddToGroup = async () => {
    if (!bulkGroupId || selectedPeople.length === 0) return;
    const results = await Promise.allSettled(selectedPeople.map((personId) => addMembership.mutateAsync({ groupId: bulkGroupId, personId })));
    const added = results.filter((result) => result.status === "fulfilled").length;
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const alreadyMembers = rejected.filter((result) => String(result.reason?.message || "").toLowerCase().includes("duplicate")).length;
    const errors = rejected.length - alreadyMembers;
    showToast.success(`${added} added, ${alreadyMembers} already members, ${errors} errors`);
    qc.invalidateQueries({ queryKey: ["contact_group_memberships", bulkGroupId] });
    clearSelection();
    setBulkAddOpen(false);
    setBulkGroupId("");
  };

  // ── Helpers ──
  const startEditing = (person: Person) => {
    setEditingAliases([...(person.aliases || [])]);
    setEditingNotes(person.notes || "");
    setEditingName(person.name);
    setNewAlias("");
  };

  const addAlias = () => {
    if (!newAlias.trim() || !editingAliases) return;
    if (editingAliases.includes(newAlias.trim())) return;
    setEditingAliases([...editingAliases, newAlias.trim()]);
    setNewAlias("");
  };

  const removeAlias = (alias: string) => {
    if (!editingAliases) return;
    setEditingAliases(editingAliases.filter((a) => a !== alias));
  };

  const cancelEditing = () => {
    setEditingAliases(null);
    setEditingNotes(null);
    setEditingName(null);
  };

  const saveChanges = () => {
    if (!selectedPerson) return;
    const updates: any = {};
    if (editingAliases !== null) updates.aliases = editingAliases;
    if (editingNotes !== null) updates.notes = editingNotes || null;
    if (editingName !== null) {
      const trimmed = editingName.trim();
      if (!trimmed) {
        showToast.error("Name cannot be empty");
        return;
      }
      updates.name = trimmed;
    }
    updatePerson.mutate(
      { id: selectedPerson.id, ...updates },
      {
        onSuccess: () => {
          showToast.success("Saved");
          setEditingAliases(null);
          setEditingNotes(null);
          setEditingName(null);
        },
      },
    );
  };

  const isEditing = editingAliases !== null;

  // ── Detail view ──
  if (selectedPerson) {
    const aliases = isEditing ? editingAliases! : (selectedPerson.aliases || []);
    const notes = isEditing ? editingNotes! : (selectedPerson.notes || "");
    return (
      <div className="max-w-3xl">
        <SEOHead title={`${selectedPerson.name} — People — Menerio`} noIndex />

        <Button variant="ghost" size="sm" onClick={() => { closePerson(); cancelEditing(); setActivePersonTab("profile"); }} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to People
        </Button>

        {/* Persistent person header — visible across all tabs */}
        <div className="sticky top-0 z-10 bg-background pb-2 space-y-4 mb-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    {isEditing ? (
                      <Input
                        value={editingName ?? ""}
                        onChange={(e) => setEditingName(e.target.value)}
                        placeholder="Name"
                        className="h-9 text-xl font-semibold"
                      />
                    ) : (
                      selectedPerson.name
                    )}
                  </CardTitle>

                  {/* Aliases */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {aliases.map((alias) => (
                      <Badge key={alias} variant="secondary" className="text-xs gap-1">
                        {alias}
                        {isEditing && (
                          <button onClick={() => removeAlias(alias)} className="ml-0.5 hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                    {isEditing && (
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 w-32 text-xs"
                          placeholder="Add alias..."
                          value={newAlias}
                          onChange={(e) => setNewAlias(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addAlias()}
                        />
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={addAlias}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {!isEditing && aliases.length === 0 && (
                      <span className="text-xs text-muted-foreground">No aliases</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 items-center">
                  {!isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mr-1"
                        onClick={() =>
                          toggleFavorite.mutate({ id: selectedPerson.id, isFavorite: !selectedPerson.is_favorite })
                        }
                        title={selectedPerson.is_favorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Star className={cn("h-4 w-4", selectedPerson.is_favorite && "fill-warning text-warning")} />
                      </Button>
                      <AiVisibilityButton
                        kind="person"
                        id={selectedPerson.id}
                        hidden={!!(selectedPerson as any).is_sensitive}
                        className="mr-1"
                      />
                      <Button variant="outline" size="sm" onClick={() => startEditing(selectedPerson)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
                        <Merge className="h-3.5 w-3.5 mr-1" /> Merge
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={cancelEditing}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveChanges} disabled={updatePerson.isPending}>
                        {updatePerson.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Save
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => deletePerson.mutate(selectedPerson.id, { onSuccess: () => closePerson() })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Duplicate detection */}
          <DuplicateHints
            person={selectedPerson}
            allPeople={people}
            onMerge={(targetId) => {
              setMergePrefillId(targetId);
              setMergeOpen(true);
            }}
          />
        </div>

        <Tabs value={activePersonTab} onValueChange={setActivePersonTab} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-0">
            <ContactProfileTab
              contactId={selectedPerson.id}
              contactName={selectedPerson.name}
              notes={notes}
              isEditingNotes={isEditing}
              onChangeNotes={(value) => setEditingNotes(value)}
              relatedNotes={relatedNotes as Array<{ id: string; title: string | null }>}
            />
          </TabsContent>

          <TabsContent value="groups" className="mt-0">
            <PersonGroupsTab personId={selectedPerson.id} />
          </TabsContent>

          <TabsContent value="conversation" className="mt-0">
            <ConversationTab personId={selectedPerson.id} personName={selectedPerson.name} initialContext={conversationContext} />
          </TabsContent>

          <TabsContent value="timeline" className="mt-0">
            <PersonTimeline
              personId={selectedPerson.id}
              personName={selectedPerson.name}
              people={people.map((person) => ({ id: person.id, name: person.name, relationship: null }))}
              onAskMira={(context) => {
                setConversationContext(context);
                setActivePersonTab("conversation");
              }}
            />
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <PersonDocuments personId={selectedPerson.id} personName={selectedPerson.name} />
          </TabsContent>
        </Tabs>

      <MergePersonDialog
        open={mergeOpen}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) setMergePrefillId(null);
        }}
        sourcePerson={selectedPerson}
        allPeople={people}
        prefillTargetId={mergePrefillId}
        onMergeComplete={() => {
          setMergeOpen(false);
          setMergePrefillId(null);
          closePerson();
        }}
      />
    </div>
  );
}

  return (
    <div className="max-w-3xl space-y-6">
      <SEOHead title="People — Menerio" noIndex />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            People <span className="text-muted-foreground font-normal">· {people.length}</span>
          </h1>
          <p className="text-sm text-muted-foreground">Manage the people connected to your notes.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add person
            </Button>
          </DialogTrigger>
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
                  if (event.key === "Enter" && createName.trim()) {
                    submitCreatePerson();
                  }
                }}
                placeholder="Ada Lovelace"
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
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {groups.filter((group) => !group.archived_at).map((group) => (
              <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search people..."
            className="pl-9"
          />
        </div>
      </div>

      {selectedPeople.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-sm">
          <span className="text-sm font-medium">{selectedPeople.length} selected</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setBulkAddOpen(true)}>Add to Group</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear selection</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No people found</p>
              <p className="text-sm text-muted-foreground">Add a person or adjust your search.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((person) => (
            <div
              key={person.id}
              onClick={() => openPerson(person.id)}
              className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox
                  checked={selectedSet.has(person.id)}
                  onCheckedChange={() => toggleSelected(person.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Select ${person.name}`}
                />
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <button type="button" onClick={(event) => { event.stopPropagation(); openPerson(person.id); }} className="min-w-0 text-left">
                  <p className="truncate font-medium text-foreground">{person.name}</p>
                  {(person.aliases || []).length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">{person.aliases.join(", ")}</p>
                  )}
                </button>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                {(person.tags || []).length > 0 && (
                  <Badge variant="secondary">{person.tags[0]}</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite.mutate({ id: person.id, isFavorite: !person.is_favorite });
                  }}
                  title={person.is_favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star className={cn("h-4 w-4", person.is_favorite && "fill-warning text-warning")} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={bulkAddOpen} onOpenChange={setBulkAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add selected people to group</DialogTitle>
            <DialogDescription>Choose a group for the selected people.</DialogDescription>
          </DialogHeader>
          <Select value={bulkGroupId} onValueChange={setBulkGroupId}>
            <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
            <SelectContent>
              {groups.filter((group) => !group.archived_at).map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAddOpen(false)}>Cancel</Button>
            <Button onClick={bulkAddToGroup} disabled={!bulkGroupId || addMembership.isPending}>
              {addMembership.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

