import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, X } from "lucide-react";
import { FactsPanel } from "@/components/facts/FactsPanel";
import {
  useDeleteEntity,
  useEntityMoments,
  useEntityNotes,
  useUpdateEntity,
  type Entity,
} from "@/hooks/useEntities";

interface EntityDetailProps {
  entity: Entity;
  onDeleted: () => void;
}

/** Detail view for a place, organization, project, thing or pet. */
export function EntityDetail({ entity, onDeleted }: EntityDetailProps) {
  const updateEntity = useUpdateEntity();
  const deleteEntity = useDeleteEntity();
  const { data: moments = [] } = useEntityMoments(entity.id);
  const { data: notes = [] } = useEntityNotes(entity);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entity.name);
  const [entityType, setEntityType] = useState(entity.entity_type);
  const [aliases, setAliases] = useState((entity.aliases || []).join(", "));
  const [description, setDescription] = useState(entity.description || "");

  const startEditing = () => {
    setName(entity.name);
    setEntityType(entity.entity_type);
    setAliases((entity.aliases || []).join(", "));
    setDescription(entity.description || "");
    setEditing(true);
  };

  const save = () => {
    updateEntity.mutate(
      {
        id: entity.id,
        name,
        entity_type: entityType,
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        description: description.trim() || null,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const remove = () => {
    deleteEntity.mutate(entity.id, { onSuccess: onDeleted });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {editing ? (
            <div className="space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-lg font-semibold" />
              <div className="flex flex-wrap gap-2">
                <Input
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                  placeholder="place, organization, project…"
                  className="h-8 w-48 text-sm"
                />
                <Input
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  placeholder="Also known as (comma separated)"
                  className="h-8 flex-1 min-w-48 text-sm"
                />
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this?"
                rows={2}
                className="text-sm"
              />
            </div>
          ) : (
            <>
              <h1 className="truncate text-xl font-semibold">{entity.name}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="capitalize">{entity.entity_type}</Badge>
                {(entity.aliases || []).map((alias) => (
                  <span key={alias} className="text-xs text-muted-foreground">aka {alias}</span>
                ))}
              </div>
              {entity.description && (
                <p className="text-sm text-muted-foreground">{entity.description}</p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={save} disabled={!name.trim() || updateEntity.isPending}>
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" onClick={startEditing} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={remove} title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <FactsPanel subjectType="entity" subjectId={entity.id} subjectLabel={entity.name} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Timeline{moments.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{moments.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {moments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No moments linked to {entity.name} yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {moments.map((m: any) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <Link to={`/dashboard/timeline?moment=${m.id}`} className="truncate hover:underline">
                    {m.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.happened_at ? new Date(m.happened_at).toLocaleDateString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mentioned in notes</CardTitle>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes mention {entity.name} yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <Link to={`/dashboard/notes?note=${n.id}`} className="hover:underline">
                    {n.title || "Untitled"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
