import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { dbErrorMessage } from "@/lib/function-error";
import { LoadErrorState } from "@/components/collections/LoadErrorState";
import {
  defaultField,
  duplicateField,
  indexableTypes,
  newField,
  normalizePrimary,
  optionTypes,
  parseSchema,
  relabelField,
  toJsonSchema,
  validateFields,
  type FieldErrors,
  type FieldType,
  type SchemaField,
} from "@/components/collections/schemaFields";

type Collection = Database["public"]["Tables"]["collections"]["Row"];

function SortableFieldRow({
  field,
  collections,
  errors,
  onChange,
  onDuplicate,
  onDelete,
  onPrimary,
  onToggleIndexable,
}: {
  field: SchemaField;
  collections: Collection[];
  errors?: string[];
  onChange: (field: SchemaField) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPrimary: () => void;
  onToggleIndexable: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const updateType = (type: FieldType) =>
    onChange({
      ...field,
      type,
      indexable: indexableTypes.has(type) ? field.indexable : false,
      options: optionTypes.has(type)
        ? (field.options ?? ["Option"])
        : undefined,
    });
  const addOption = (value: string) => {
    const next = value.trim();
    if (next) onChange({ ...field, options: [...(field.options ?? []), next] });
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn("transition-shadow", isDragging && "shadow-lg")}
    >
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <button
            type="button"
            className="mt-2 text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            aria-label="Reorder field"
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {field.primary && (
                <Badge variant="secondary" className="text-[10px]">
                  PRIMARY
                </Badge>
              )}
              {field.indexable && (
                <Badge variant="outline" className="text-[10px]">
                  INDEXABLE
                </Badge>
              )}
            </div>
            <Input
              value={field.label}
              onChange={(event) =>
                onChange(relabelField(field, event.target.value))
              }
              placeholder="Field label"
              aria-label="Field label"
            />
            <p className="text-xs text-muted-foreground">
              key: {field.key}
              {!field.isNew && " (stays the same when you rename the field)"}
            </p>
            {errors?.map((error) => (
              <p key={error} className="text-xs text-destructive">
                {error}
              </p>
            ))}
          </div>
          <div className="w-full lg:w-64">
            <Select
              value={field.type}
              onValueChange={(value) => updateType(value as FieldType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Basic</SelectLabel>
                  {[
                    ["text", "Text"],
                    ["longtext", "Long text"],
                    ["number", "Number"],
                    ["date", "Date"],
                    ["datetime", "Date and time"],
                    ["boolean", "Yes/No"],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Choice</SelectLabel>
                  <SelectItem value="select">Single choice</SelectItem>
                  <SelectItem value="multiselect">Multiple choice</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Specialized</SelectLabel>
                  {[
                    ["currency", "Currency"],
                    ["url", "URL"],
                    ["email", "Email"],
                    ["phone", "Phone"],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Links</SelectLabel>
                  <SelectItem value="link_note">Link to Note</SelectItem>
                  <SelectItem value="link_person">Link to Person</SelectItem>
                  <SelectItem value="link_collection_item">
                    Link to another Collection
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Field actions" variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onPrimary}>
                Mark as primary field
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!indexableTypes.has(field.type)}
                onClick={onToggleIndexable}
              >
                Mark as indexable
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {optionTypes.has(field.type) && (
          <div className="mt-4 border-t pt-4">
            <OptionEditor
              field={field}
              onChange={onChange}
              addOption={addOption}
            />
          </div>
        )}
        {field.type === "link_collection_item" && (
          <div className="mt-4 max-w-sm border-t pt-4">
            <Label>Target collection</Label>
            <Select
              value={field.target_collection_slug ?? ""}
              onValueChange={(targetSlug) =>
                onChange({ ...field, target_collection_slug: targetSlug })
              }
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Choose collection" />
              </SelectTrigger>
              <SelectContent>
                {collections.map((collection) => (
                  <SelectItem key={collection.id} value={collection.slug}>
                    {collection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptionEditor({
  field,
  onChange,
  addOption,
}: {
  field: SchemaField;
  onChange: (field: SchemaField) => void;
  addOption: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <Label>Categories / Options</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          The choices users (and the AI) can pick from for this field.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((option, index) => (
          <span
            key={`${option}-${index}`}
            className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-sm"
          >
            {option}
            <button aria-label={`Remove option ${option}`}
              type="button"
              onClick={() =>
                onChange({
                  ...field,
                  options: (field.options ?? []).filter((_, i) => i !== index),
                })
              }
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addOption(value);
          setValue("");
        }}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="+ add option"
        />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
    </div>
  );
}

export default function CollectionSchema() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [fields, setFields] = useState<SchemaField[]>([defaultField()]);
  const [initialSchema, setInitialSchema] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadFailure, setLoadFailure] = useState<"error" | "missing" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const userId = user?.id;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const serialized = useMemo(
    () => JSON.stringify(toJsonSchema(fields)),
    [fields],
  );
  const isDirty = serialized !== initialSchema;

  // Depends on the user's id, not the user object: a token refresh must not
  // reload the schema and throw away edits in progress.
  useEffect(() => {
    if (!userId || !slug) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadFailure(null);
      const [{ data: current, error }, { data: allCollections }] =
        await Promise.all([
          supabase
            .from("collections")
            .select("*")
            .eq("user_id", userId)
            .eq("slug", slug)
            .maybeSingle(),
          supabase
            .from("collections")
            .select("*")
            .eq("user_id", userId)
            .order("name"),
        ]);
      if (cancelled) return;
      if (error || !current) {
        // Without the saved schema this page would show a blank default
        // field, which is not what the collection holds.
        setLoadFailure(error ? "error" : "missing");
        setIsLoading(false);
        return;
      }
      const parsed = normalizePrimary(parseSchema(current.field_schema));
      setCollection(current);
      setCollections(allCollections ?? []);
      setFields(parsed);
      setInitialSchema(JSON.stringify(toJsonSchema(parsed)));
      setIsLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [slug, userId, reloadTick]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!isDirty) return;
      const link = (event.target as HTMLElement | null)?.closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        link.origin !== window.location.origin ||
        link.pathname === window.location.pathname
      )
        return;
      if (!window.confirm("Discard unsaved schema changes?"))
        event.preventDefault();
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [isDirty]);

  const updateField = (id: string, next: SchemaField) =>
    setFields((current) =>
      current.map((field) => (field.id === id ? next : field)),
    );
  const addField = () => setFields((current) => [...current, newField()]);
  const cancel = () => {
    if (isDirty && !window.confirm("Discard unsaved schema changes?")) return;
    navigate(`/collections/${slug}`);
  };
  const save = async () => {
    if (!collection) return;
    const normalizedFields = normalizePrimary(fields);
    setFields(normalizedFields);
    const nextErrors = validateFields(normalizedFields);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setIsSaving(true);
    const schema = toJsonSchema(normalizedFields);
    const { error } = await supabase
      .from("collections")
      .update({ field_schema: schema })
      .eq("id", collection.id)
      .eq("user_id", collection.user_id);
    setIsSaving(false);
    if (error) {
      toast.error("Could not save schema", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    setInitialSchema(JSON.stringify(schema));
    toast.success("Schema saved");
    navigate(`/collections/${collection.slug}`);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields((current) =>
      arrayMove(
        current,
        current.findIndex((field) => field.id === active.id),
        current.findIndex((field) => field.id === over.id),
      ),
    );
  };

  if (isLoading)
    return (
      <div className="w-full max-w-5xl space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );

  if (loadFailure)
    return (
      <div className="w-full max-w-5xl">
        <SEOHead title="Collection Schema - Menerio" noIndex />
        <LoadErrorState
          title={
            loadFailure === "missing"
              ? "This collection could not be found."
              : "The collection could not be loaded."
          }
          description={
            loadFailure === "missing"
              ? "It may have been renamed or deleted."
              : undefined
          }
          onRetry={
            loadFailure === "error"
              ? () => setReloadTick((tick) => tick + 1)
              : undefined
          }
          backTo="/collections"
          backLabel="Back to Collections"
        />
      </div>
    );

  return (
    <div className="w-full max-w-5xl space-y-6">
      <SEOHead
        title={`${collection?.name ?? "Collection"} Schema — Menerio`}
        noIndex
      />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Collections / {collection?.name} / Schema
          </p>
          <h1 className="mt-2 text-2xl font-bold font-display">
            {collection?.icon} {collection?.name} — Schema
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define the fields this collection tracks. You can add, remove, or
            reorder fields anytime.
          </p>
          {isDirty && (
            <p className="mt-2 text-xs text-primary">Unsaved changes</p>
          )}
          {errors.__form?.map((error) => (
            <p key={error} className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            Save
          </Button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={fields.map((field) => field.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {fields.map((field) => (
              <SortableFieldRow
                key={field.id}
                field={field}
                collections={collections.filter(
                  (item) => item.id !== collection?.id,
                )}
                errors={errors[field.id]}
                onChange={(next) => updateField(field.id, next)}
                onPrimary={() =>
                  setFields((current) =>
                    current.map((item) => ({
                      ...item,
                      primary: item.id === field.id,
                    })),
                  )
                }
                onToggleIndexable={() =>
                  updateField(field.id, {
                    ...field,
                    indexable: !field.indexable,
                  })
                }
                onDuplicate={() =>
                  setFields((current) => [...current, duplicateField(field)])
                }
                onDelete={() =>
                  setFields((current) =>
                    current.filter((item) => item.id !== field.id),
                  )
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={addField}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-4 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-4 w-4" /> Add field
      </button>
    </div>
  );
}
