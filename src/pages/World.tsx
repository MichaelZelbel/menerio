import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEOHead } from "@/components/SEOHead";
import { EntityDetail } from "@/components/world/EntityDetail";
import {
  ENTITY_TYPE_SUGGESTIONS,
  useCreateEntity,
  useEntities,
} from "@/hooks/useEntities";

/**
 * "World" — the non-person things in a user's life: places, organizations,
 * projects, objects and pets. People stay under People; this sits next to it.
 */
export default function World() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: entities = [], isLoading } = useEntities();
  const createEntity = useCreateEntity();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("place");

  // Filter chips come from the data, not a hardcoded list — the vocabulary is open.
  const types = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of entities) seen.set(e.entity_type, (seen.get(e.entity_type) || 0) + 1);
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [entities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities.filter((e) => {
      if (typeFilter && e.entity_type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        (e.description || "").toLowerCase().includes(q)
      );
    });
  }, [entities, search, typeFilter]);

  const selected = entities.find((e) => e.id === id) ?? null;

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

  return (
    <>
      <SEOHead title="World — Menerio" description="Places, organizations, projects and things in your life." />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">World</h1>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setAdding((v) => !v)}>
              {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {adding ? "Cancel" : "Add"}
            </Button>
          </div>

          {adding && (
            <div className="space-y-2 rounded-md border border-dashed border-border p-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="Name"
                className="h-8 text-sm"
                autoFocus
              />
              <Input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                list="entity-type-suggestions"
                placeholder="Type"
                className="h-8 text-sm"
              />
              <datalist id="entity-type-suggestions">
                {ENTITY_TYPE_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Button size="sm" className="w-full" onClick={create} disabled={!newName.trim() || createEntity.isPending}>
                Add
              </Button>
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {types.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {types.map(([type, count]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs capitalize transition-colors",
                    typeFilter === type
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {type} {count}
                </button>
              ))}
            </div>
          )}

          <nav className="space-y-0.5">
            {isLoading ? (
              <p className="px-2 text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">
                {entities.length === 0
                  ? "Nothing here yet. Add a place, an organization, a project or a thing."
                  : "No matches."}
              </p>
            ) : (
              filtered.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => navigate(`/dashboard/world/${entity.id}`)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    entity.id === id ? "bg-accent font-medium" : "hover:bg-accent/60",
                  )}
                >
                  <span className="truncate">{entity.name}</span>
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] capitalize">
                    {entity.entity_type}
                  </Badge>
                </button>
              ))
            )}
          </nav>
        </aside>

        <section className="min-w-0">
          {selected ? (
            <EntityDetail entity={selected} onDeleted={() => navigate("/dashboard/world")} />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">
                Select something to see its facts, timeline and the notes that mention it.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
