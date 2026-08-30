import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEOHead } from "@/components/SEOHead";
import { EntityDetail } from "@/components/world/EntityDetail";
import { ENTITY_TYPE_SUGGESTIONS, useCreateEntity, useEntities } from "@/hooks/useEntities";
import { useWorldClaims, useWorldEntities, useWorldEvents } from "@/hooks/useWorld";
import { groupClaims, isHumanWritten, isStale } from "@/lib/world-claims";

/**
 * World: everything in your life as three lists. A thing that exists (entity),
 * a thing that happened (event), a thing believed about something (claim).
 *
 * Every row here already existed somewhere else. World is a view over your
 * people, your moments and your facts, so nothing is copied and no name ends up
 * in two places.
 */
export default function World() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: entities = [], isLoading: entitiesLoading } = useWorldEntities();
  const { data: events = [], isLoading: eventsLoading } = useWorldEvents();
  const { data: claims = [], isLoading: claimsLoading } = useWorldClaims();
  const { data: ownEntities = [] } = useEntities();
  const createEntity = useCreateEntity();

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("place");

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, e.name);
    return map;
  }, [entities]);

  const kinds = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of entities) seen.set(e.kind, (seen.get(e.kind) || 0) + 1);
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [entities]);

  const visibleEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities.filter((e) => {
      if (kindFilter && e.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        (e.description || "").toLowerCase().includes(q)
      );
    });
  }, [entities, search, kindFilter]);

  const visibleEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q),
    );
  }, [events, search]);

  const claimGroups = useMemo(() => {
    const groups = groupClaims(claims);
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.attribute.toLowerCase().includes(q) ||
        g.top.value.toLowerCase().includes(q) ||
        (g.subject_id ? (nameById.get(g.subject_id) || "").toLowerCase().includes(q) : false),
    );
  }, [claims, search, nameById]);

  // Only a row that lives in the `entities` table has an editable detail view.
  // A person opens on the People screen, which is their real home.
  const selected = ownEntities.find((e) => e.id === id) ?? null;

  const subjectName = (kind: string, subjectId: string | null) => {
    if (kind === "self" || !subjectId) return "You";
    return nameById.get(subjectId) || "Someone";
  };

  const create = () => {
    if (!newName.trim()) return;
    createEntity.mutate(
      { name: newName, entity_type: newType },
      {
        onSuccess: (entity) => {
          setNewName("");
          setAdding(false);
          navigate(`/dashboard/world/${entity.id}`);
        },
      },
    );
  };

  if (selected) {
    return (
      <>
        <SEOHead title="World — Menerio" description="Everything in your life as entities, events and claims." />
        <EntityDetail entity={selected} onDeleted={() => navigate("/dashboard/world")} />
      </>
    );
  }

  return (
    <>
      <SEOHead title="World — Menerio" description="Everything in your life as entities, events and claims." />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">World</h1>
            <p className="text-sm text-muted-foreground">
              Things that exist, things that happened, and what is believed about them.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setAdding((v) => !v)}>
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? "Cancel" : "Add a thing"}
          </Button>
        </div>

        {adding && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Name"
              className="h-8 w-48 text-sm"
              autoFocus
            />
            <Input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              list="entity-type-suggestions"
              placeholder="Type"
              className="h-8 w-36 text-sm"
            />
            <datalist id="entity-type-suggestions">
              {ENTITY_TYPE_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <Button size="sm" onClick={create} disabled={!newName.trim() || createEntity.isPending}>
              Add
            </Button>
            <span className="text-xs text-muted-foreground">
              People are added on the People screen.
            </span>
          </div>
        )}

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the whole world"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <Tabs defaultValue="entities">
          <TabsList>
            <TabsTrigger value="entities">Entities {entities.length > 0 && entities.length}</TabsTrigger>
            <TabsTrigger value="events">Events {events.length > 0 && events.length}</TabsTrigger>
            <TabsTrigger value="claims">Claims {claimGroups.length > 0 && claimGroups.length}</TabsTrigger>
          </TabsList>

          <TabsContent value="entities" className="space-y-3 pt-3">
            {kinds.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {kinds.map(([kind, count]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter(kindFilter === kind ? null : kind)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs capitalize transition-colors",
                      kindFilter === kind
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {kind} {count}
                  </button>
                ))}
              </div>
            )}

            {entitiesLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : visibleEntities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing matches.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {visibleEntities.map((entity) => (
                  <li key={`${entity.source_table}-${entity.id}`}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          entity.source_table === "contact"
                            ? `/dashboard/people/${entity.id}`
                            : `/dashboard/world/${entity.id}`,
                        )
                      }
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{entity.name}</span>
                        {entity.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {entity.description}
                          </span>
                        )}
                      </span>
                      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] capitalize">
                        {entity.kind}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-3 pt-3">
            {eventsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : visibleEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing dated yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {visibleEvents.map((event) => (
                  <li key={event.id} className="flex gap-3 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">
                      {(event.happened_at || "").slice(0, 10)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{event.title}</span>
                      {event.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {event.description}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="claims" className="space-y-3 pt-3">
            {claimsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : claimGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing believed yet.</p>
            ) : (
              <ul className="space-y-2">
                {claimGroups.map((group) => (
                  <li key={group.key} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs text-muted-foreground">
                        {subjectName(group.subject_kind, group.subject_id)}
                      </span>
                      <span className="font-medium capitalize">{group.attribute}</span>
                      <span>{group.top.value}</span>
                      {isHumanWritten(group.top) ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          you wrote this
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          a machine wrote this
                        </Badge>
                      )}
                      {(group.top.valid_from || group.top.valid_to) && (
                        <span className="text-xs text-muted-foreground">
                          {group.top.valid_from || "always"} to {group.top.valid_to || "now"}
                        </span>
                      )}
                      {isStale(group.top) && (
                        <Badge variant="outline" className="border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400">
                          not checked since {group.top.review_by}
                        </Badge>
                      )}
                    </div>

                    {/* The sentence this fact came from, and a way back to it.
                        Without these a fact is an assertion you cannot check,
                        which is exactly what makes a second brain stop being
                        trustworthy. */}
                    {group.top.evidence_quote && (
                      <blockquote className="mt-1.5 border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
                        {group.top.evidence_quote}
                      </blockquote>
                    )}
                    {group.top.source_kind === "note" && group.top.source_ref && (
                      <Link
                        to={`/dashboard/notes/${group.top.source_ref}`}
                        className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
                      >
                        open the note this came from
                      </Link>
                    )}

                    {group.others.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-l-2 border-border pl-3">
                        {group.others.map((other) => (
                          <div key={other.id} className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                            <span>{other.value}</span>
                            <span>
                              {isHumanWritten(other) ? "you wrote this too" : "a machine also wrote"}
                            </span>
                          </div>
                        ))}
                        {group.disagreed && (
                          <p className="text-xs text-muted-foreground">
                            Kept, not replaced. Your version is the one above.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
