import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
const useIsAdmin = () => { const { role } = useAuth(); return role === "admin"; };
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
  Link2,
  Merge,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ContactProfileTab } from "@/components/people/ContactProfileTab";
import { MergePersonDialog } from "@/components/people/MergePersonDialog";
import { DuplicateHints } from "@/components/people/DuplicateHints";

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

// Connected apps we know about for identity mapping
const KNOWN_APPS = [
  { key: "cherishly", label: "Cherishly" },
  { key: "temerio", label: "Temerio" },
];

export default function People() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const isAdmin = useIsAdmin();
  const [mergeOpen, setMergeOpen] = useState(false);
  // Inline editing state for detail view
  const [editingAliases, setEditingAliases] = useState<string[] | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingMappings, setEditingMappings] = useState<Record<string, { display_name?: string }> | null>(null);

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
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.aliases || []).some((a) => a.toLowerCase().includes(q))
    );
  });

  // ── Helpers ──
  const startEditing = (person: Person) => {
    setEditingAliases([...(person.aliases || [])]);
    setEditingNotes(person.notes || "");
    setEditingMappings({ ...(person.app_mappings || {}) });
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

  const setAppMapping = (appKey: string, displayName: string) => {
    if (!editingMappings) return;
    setEditingMappings({
      ...editingMappings,
      [appKey]: { display_name: displayName || undefined },
    });
  };

  const saveChanges = () => {
    if (!selectedPerson) return;
    const updates: any = {};
    if (editingAliases !== null) updates.aliases = editingAliases;
    if (editingNotes !== null) updates.notes = editingNotes || null;
    if (editingMappings !== null) {
      // Clean out empty mappings
      const cleaned: Record<string, { display_name?: string }> = {};
      for (const [k, v] of Object.entries(editingMappings)) {
        if (v.display_name) cleaned[k] = v;
      }
      updates.app_mappings = cleaned;
    }
    updatePerson.mutate(updates, {
      onSuccess: () => {
        showToast.success("Saved");
        setEditingAliases(null);
        setEditingNotes(null);
        setEditingMappings(null);
      },
    });
  };

  const isEditing = editingAliases !== null;

  // ── Detail view ──
  if (selectedPerson) {
    const aliases = isEditing ? editingAliases! : (selectedPerson.aliases || []);
    const notes = isEditing ? editingNotes! : (selectedPerson.notes || "");
    const mappings = isEditing ? editingMappings! : (selectedPerson.app_mappings || {});

    return (
      <div className="max-w-3xl">
        <SEOHead title={`${selectedPerson.name} — People — Menerio`} noIndex />

        <Button variant="ghost" size="sm" onClick={() => { setSelectedPersonId(null); setEditingAliases(null); setEditingNotes(null); setEditingMappings(null); }} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to People
        </Button>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
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
                    <Button variant="outline" size="sm" onClick={() => startEditing(selectedPerson)}>
                      Edit
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingAliases(null); setEditingNotes(null); setEditingMappings(null); }}>
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

          {/* App Identity Mapping — admin only */}
          {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                App Identity Mapping
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {KNOWN_APPS.map((app) => {
                  const mapping = mappings[app.key];
                  return (
                    <div key={app.key} className="flex items-center gap-3">
                      <span className="text-sm font-medium w-24 shrink-0">{app.label}</span>
                      {isEditing ? (
                        <Input
                          className="h-8 text-sm"
                          placeholder={`Display name in ${app.label}...`}
                          value={mapping?.display_name || ""}
                          onChange={(e) => setAppMapping(app.key, e.target.value)}
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {mapping?.display_name || "—"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {!isEditing && Object.keys(mappings).length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  No app mappings configured. Click Edit to add how this person is known in other apps.
                </p>
              )}
            </CardContent>
          </Card>
          )}

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea
                  value={notes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  placeholder="Freeform notes about this person..."
                  rows={3}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {notes || "No notes yet."}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Related Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Related Knowledge
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notes mention this person yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {relatedNotes.map((note: any) => (
                    <Link
                      key={note.id}
                      to={`/dashboard/notes/${note.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">{note.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(note.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="profile" className="mt-0">
            <ContactProfileTab contactId={selectedPerson.id} contactName={selectedPerson.name} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-3xl">
      <SEOHead title="People — Menerio" noIndex />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold">People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your identity layer for cross-app person mapping
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Add Person</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Person</DialogTitle>
              <DialogDescription>Add a new person to your knowledge system.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Kalena"
                  onKeyDown={(e) => e.key === "Enter" && createName.trim() && createPerson.mutate(createName)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createPerson.mutate(createName)} disabled={!createName.trim() || createPerson.isPending}>
                {createPerson.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or alias..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Person List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{people.length === 0 ? "No people yet. Add someone to get started." : "No people match your search."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPersonId(p.id)}
              className="w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.aliases && p.aliases.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                      aka {p.aliases.join(", ")}
                    </p>
                  )}
                </div>
              </div>
              {Object.keys(p.app_mappings || {}).length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  {Object.keys(p.app_mappings).map((app) => (
                    <Badge key={app} variant="outline" className="text-[10px] capitalize">
                      {app}
                    </Badge>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
