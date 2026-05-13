import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  FileText,
  Merge,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ContactProfileTab } from "@/components/people/ContactProfileTab";
import { MergePersonDialog } from "@/components/people/MergePersonDialog";
import { DuplicateHints } from "@/components/people/DuplicateHints";
import { ConversationTab } from "@/components/people/ConversationTab";
import { PersonTimeline } from "@/components/people/PersonTimeline";
import { PersonDocuments } from "@/components/people/PersonDocuments";
import { PersonGroupsTab } from "@/components/people/PersonGroupsTab";
import { useGroups } from "@/hooks/useGroups";
import { useAddMembership, useGroupMemberships } from "@/hooks/useGroupMemberships";

interface Person {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  tags: string[];
  aliases: string[];
  app_mappings: Record<string, { display_name?: string }>;
  metadata: Record<string, unknown>;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

export default function People() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
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
  const [activePersonTab, setActivePersonTab] = useState("overview");
  const [conversationContext, setConversationContext] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkGroupId, setBulkGroupId] = useState("");
  const addMembership = useAddMembership();

  // ── Queries ──
  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ["contacts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, user_id, name, notes, tags, aliases, app_mappings, metadata, merged_into, created_at, updated_at")
        .eq("user_id", user!.id)
        .is("merged_into", null)
        .order("name");
      if (error) throw error;
      return (data || []).map((d: any) => ({
        ...d,
        aliases: d.aliases || [],
        app_mappings: d.app_mappings || {},
      })) as Person[];
    },
  });

  const selectedPerson = people.find((p) => p.id === selectedPersonId);
  const { data: groups = [] } = useGroups();
  const { data: groupFilterMemberships = [] } = useGroupMemberships(groupFilter === "all" ? null : groupFilter);

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
  const createPerson = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("contacts").insert({
        user_id: user!.id,
        name: name.trim(),
        aliases: [],
        app_mappings: {},
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setCreateOpen(false);
      setCreateName("");
      showToast.success("Person added");
    },
    onError: (e: any) => showToast.error(e.message),
  });

  const updatePerson = useMutation({
    mutationFn: async (updates: Partial<Pick<Person, "name" | "notes" | "aliases" | "app_mappings">>) => {
      const { error } = await supabase
        .from("contacts")
        .update(updates as any)
        .eq("id", selectedPersonId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: any) => showToast.error(e.message),
  });

  const deletePerson = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setSelectedPersonId(null);
      showToast.success("Person removed");
    },
  });

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
    updatePerson.mutate(updates, {
      onSuccess: () => {
        showToast.success("Saved");
        setEditingAliases(null);
        setEditingNotes(null);
        setEditingName(null);
      },
    });
  };

  const isEditing = editingAliases !== null;

  // ── Detail view ──
  if (selectedPerson) {
    const aliases = isEditing ? editingAliases! : (selectedPerson.aliases || []);
    const notes = isEditing ? editingNotes! : (selectedPerson.notes || "");
    return (
      <div className="max-w-3xl">
        <SEOHead title={`${selectedPerson.name} — People — Menerio`} noIndex />

        <Button variant="ghost" size="sm" onClick={() => { setSelectedPersonId(null); setEditingAliases(null); setEditingNotes(null); setActivePersonTab("overview"); }} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to People
        </Button>

        <Tabs value={activePersonTab} onValueChange={setActivePersonTab} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-0">
          {/* Header Card */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    {selectedPerson.name}
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

                <div className="flex gap-1">
                  {!isEditing ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => startEditing(selectedPerson)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
                        <Merge className="h-3.5 w-3.5 mr-1" /> Merge
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingAliases(null); setEditingNotes(null); }}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveChanges} disabled={updatePerson.isPending}>
                        {updatePerson.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Save
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deletePerson.mutate(selectedPerson.id)}>
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

          <Card>
            <CardContent className="pt-6">
              {isEditing ? (
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setEditingNotes(e.target.value)}
                    placeholder="Add private notes about this person..."
                    className="min-h-24"
                  />
                </div>
              ) : notes ? (
                <p className="text-sm whitespace-pre-wrap">{notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Related Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No related notes found.</p>
              ) : (
                <div className="space-y-2">
                  {relatedNotes.map((note: any) => (
                    <Link key={note.id} to={`/dashboard/notes/${note.id}`} className="block rounded-md border p-3 hover:bg-accent">
                      <p className="text-sm font-medium">{note.title || "Untitled"}</p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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

        <TabsContent value="profile" className="mt-0">
          <ContactProfileTab contactId={selectedPerson.id} contactName={selectedPerson.name} />
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
          setSelectedPersonId(null);
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
          <h1 className="text-2xl font-semibold tracking-normal">People</h1>
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
                    createPerson.mutate(createName);
                  }
                }}
                placeholder="Ada Lovelace"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => createPerson.mutate(createName)} disabled={!createName.trim() || createPerson.isPending}>
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
              onClick={() => setSelectedPersonId(person.id)}
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
                <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedPersonId(person.id); }} className="min-w-0 text-left">
                  <p className="truncate font-medium text-foreground">{person.name}</p>
                  {(person.aliases || []).length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">{person.aliases.join(", ")}</p>
                  )}
                </button>
              </div>
              {(person.tags || []).length > 0 && (
                <Badge variant="secondary" className="ml-3 shrink-0">{person.tags[0]}</Badge>
              )}
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

