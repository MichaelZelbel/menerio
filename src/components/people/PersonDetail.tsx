import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Loader2, Merge, Plus, Star, Trash2, User, X } from "lucide-react";

import { ContactProfileTab } from "@/components/people/ContactProfileTab";
import { MergePersonDialog } from "@/components/people/MergePersonDialog";
import { DuplicateHints } from "@/components/people/DuplicateHints";
import { ConversationTab } from "@/components/people/ConversationTab";
import { PersonTimeline } from "@/components/people/PersonTimeline";
import { PersonDocuments } from "@/components/people/PersonDocuments";
import { PersonGroupsTab } from "@/components/people/PersonGroupsTab";
import { AiVisibilityButton } from "@/components/common/AiVisibilityButton";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useUpdatePerson,
  useDeletePerson,
  useToggleFavoritePerson,
  useTouchPersonViewed,
  type Person,
} from "@/hooks/usePeople";

interface PersonDetailProps {
  person: Person;
  people: Person[];
  onClose: () => void;
}

const AUTO_NORMALIZE_VERSION = "contact-profile-auto-normalize-health-v1";
const AUTO_NORMALIZE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const autoNormalizeInFlight = new Set<string>();

/**
 * Master-detail right pane for a selected person. Extracted from the old
 * single-column People page essentially verbatim: header card (name/aliases
 * editing, favorite, AI-visibility, edit/merge/delete), duplicate hints, and
 * the Profile/Groups/Conversation/Timeline/Documents tabs. Mounted with a
 * `key={person.id}` by the page so switching people resets all local state.
 */
export function PersonDetail({ person, people, onClose }: PersonDetailProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const toggleFavorite = useToggleFavoritePerson();
  const touchPersonViewed = useTouchPersonViewed();
  const updatePerson = useUpdatePerson();
  const deletePerson = useDeletePerson();

  const [editingAliases, setEditingAliases] = useState<string[] | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [activePersonTab, setActivePersonTab] = useState("profile");
  const [conversationContext, setConversationContext] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePrefillId, setMergePrefillId] = useState<string | null>(null);
  const invalidateContactProfile = useCallback(() => {
    if (!user?.id) return;
    queryClient.invalidateQueries({ queryKey: ["contact-profile-entries", user.id, person.id] });
    queryClient.invalidateQueries({ queryKey: ["contact-profile-categories", user.id, person.id] });
    queryClient.invalidateQueries({ queryKey: ["profile-entries", person.id] });
    queryClient.invalidateQueries({ queryKey: ["profile-categories", person.id] });
    queryClient.invalidateQueries({ queryKey: ["profile-suggestions", person.id] });
    queryClient.invalidateQueries({ queryKey: ["review-queue"] });
  }, [person.id, queryClient, user?.id]);

  const runProfileNormalization = useCallback(
    async ({ notify = false }: { notify?: boolean } = {}) => {
      try {
        const { error } = await supabase.functions.invoke("normalize-profile", {
          body: {
            action: "backfill",
            scope: "contact",
            contact_id: person.id,
            includeNotesContext: true,
          },
        });
        if (error) throw error;
        if (notify) {
          showToast.success("Profile cleanup started. Changes appear automatically when it finishes.");
        }
        // Backfill is fire-and-forget on the edge; refresh the exact query keys
        // used by ContactProfileTab after it has had time to apply safe merges.
        window.setTimeout(invalidateContactProfile, 2500);
        window.setTimeout(invalidateContactProfile, 7000);
        window.setTimeout(invalidateContactProfile, 15000);
        return true;
      } catch (err: any) {
        if (notify) showToast.error(err.message ?? "Normalization failed");
        return false;
      }
    },
    [invalidateContactProfile, person.id],
  );

  // Record a view whenever a person is opened (throttled inside the hook —
  // skips if already touched within 5 minutes). This component only mounts for
  // a loaded row, so touching here is safe (never bypasses the throttle).
  useEffect(() => {
    if (person.id) touchPersonViewed.mutate(person.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  // Normalize contact profile facts automatically when a person opens. This is
  // deliberately silent: users should not have to find or click a janitor button
  // just to collapse obvious duplicates like Allergy/Allergies or BPD: true.
  useEffect(() => {
    if (!person.id || !user?.id) return;

    const storageKey = `${AUTO_NORMALIZE_VERSION}:${user.id}:${person.id}`;
    let lastRun = 0;
    try {
      lastRun = Number(window.localStorage.getItem(storageKey) || "0");
    } catch {
      lastRun = 0;
    }

    if (Date.now() - lastRun < AUTO_NORMALIZE_MIN_INTERVAL_MS) return;
    if (autoNormalizeInFlight.has(storageKey)) return;

    autoNormalizeInFlight.add(storageKey);
    void runProfileNormalization().then((ok) => {
      autoNormalizeInFlight.delete(storageKey);
      if (!ok) return;
      try {
        window.localStorage.setItem(storageKey, String(Date.now()));
      } catch {
        // localStorage can be unavailable in private contexts; normalization
        // still succeeded, so there is nothing else to do.
      }
    });
  }, [person.id, runProfileNormalization, user?.id]);

  // Related notes (notes mentioning this person by name or alias)
  const { data: relatedNotes = [] } = useQuery({
    queryKey: ["contact_notes", person.name, person.aliases],
    enabled: !!person,
    queryFn: async () => {
      const names = [person.name, ...(person.aliases || [])];
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, created_at, metadata")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).filter((note: any) => {
        const people = note.metadata?.people as string[] | undefined;
        if (!people || !Array.isArray(people)) return false;
        return names.some((n) => people.some((p) => p.toLowerCase() === n.toLowerCase()));
      });
    },
  });

  const startEditing = () => {
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
      { id: person.id, ...updates },
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
  const aliases = isEditing ? editingAliases! : (person.aliases || []);
  const notes = isEditing ? editingNotes! : (person.notes || "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SEOHead title={`${person.name} — People — Menerio`} noIndex />

      {isMobile && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" /> People
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
          {/* Persistent person header — visible across all tabs */}
          <div className="sticky top-0 z-10 mb-4 space-y-4 bg-background pb-2">
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
                        person.name
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
                            toggleFavorite.mutate({ id: person.id, isFavorite: !person.is_favorite })
                          }
                          title={person.is_favorite ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={cn("h-4 w-4", person.is_favorite && "fill-warning text-warning")} />
                        </Button>
                        <AiVisibilityButton
                          kind="person"
                          id={person.id}
                          hidden={!!(person as any).is_sensitive}
                          className="mr-1"
                        />
                        <Button variant="outline" size="sm" onClick={startEditing}>
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
                      onClick={() => deletePerson.mutate(person.id, { onSuccess: () => onClose() })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Duplicate detection */}
            <DuplicateHints
              person={person}
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
                contactId={person.id}
                contactName={person.name}
                notes={notes}
                isEditingNotes={isEditing}
                onChangeNotes={(value) => setEditingNotes(value)}
                relatedNotes={relatedNotes as Array<{ id: string; title: string | null }>}
              />
            </TabsContent>

            <TabsContent value="groups" className="mt-0">
              <PersonGroupsTab personId={person.id} />
            </TabsContent>

            <TabsContent value="conversation" className="mt-0">
              <ConversationTab personId={person.id} personName={person.name} initialContext={conversationContext} />
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              <PersonTimeline
                personId={person.id}
                personName={person.name}
                people={people.map((p) => ({ id: p.id, name: p.name, relationship: null }))}
                onAskMira={(context) => {
                  setConversationContext(context);
                  setActivePersonTab("conversation");
                }}
              />
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              <PersonDocuments personId={person.id} personName={person.name} />
            </TabsContent>
          </Tabs>

          <MergePersonDialog
            open={mergeOpen}
            onOpenChange={(open) => {
              setMergeOpen(open);
              if (!open) setMergePrefillId(null);
            }}
            sourcePerson={person}
            allPeople={people}
            prefillTargetId={mergePrefillId}
            onMergeComplete={() => {
              setMergeOpen(false);
              setMergePrefillId(null);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
