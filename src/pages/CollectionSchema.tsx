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
import type { Database, Json } from "@/integrations/supabase/types";

type Collection = Database["public"]["Tables"]["collections"]["Row"];
type FieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "currency"
  | "url"
  | "email"
  | "phone"
  | "link_note"
  | "link_person"
  | "link_collection_item";
type SchemaField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  indexable?: boolean;
  options?: string[];
  target_collection_slug?: string | null;
};
type FieldErrors = Record<string, string[]>;

const defaultField = (): SchemaField => ({
  id: crypto.randomUUID(),
  key: "name",
  label: "Name",
  type: "text",
  primary: true,
});
const indexableTypes = new Set<FieldType>(["date", "number", "select"]);
const optionTypes = new Set<FieldType>(["select", "multiselect"]);

function fieldKey(label: string) {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

function parseSchema(value: Json): SchemaField[] {
  if (!Array.isArray(value) || value.length === 0) return [defaultField()];
  return value.map((raw, index) => {
    const item =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, Json | undefined>)
        : {};
    const label =
      typeof item.label === "string" ? item.label : `Field ${index + 1}`;
    const type =
      typeof item.type === "string" ? (item.type as FieldType) : "text";
    return {
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
      key: typeof item.key === "string" ? item.key : fieldKey(label),
      label,
      type,
      primary: item.primary === true,
      indexable: item.indexable === true,
      options: Array.isArray(item.options)
        ? item.options.filter(
            (option): option is string => typeof option === "string",
          )
        : undefined,
      target_collection_slug:
        typeof item.target_collection_slug === "string"
          ? item.target_collection_slug
          : typeof item.collection_id === "string"
            ? item.collection_id
            : null,
    };
  });
}

function toJsonSchema(fields: SchemaField[]): Json[] {
  return fields.map(({ id: _id, ...field }) => {
    const clean: Record<string, Json> = {
      key: field.key,
      label: field.label.trim(),
      type: field.type,
    };
    if (field.primary) clean.primary = true;
    if (field.indexable) clean.indexable = true;
    if (optionTypes.has(field.type)) clean.options = field.options ?? [];
    if (field.type === "link_collection_item" && field.target_collection_slug)
      clean.target_collection_slug = field.target_collection_slug;
    return clean;
  });
}

function normalizePrimary(fields: SchemaField[]) {
  if (fields.some((field) => field.primary)) return fields;
  const fallback = fields.find((field) => field.type === "text") ?? fields[0];
  return fields.map((field) => ({
    ...field,
    primary: field.id === fallback?.id,
  }));
}

function validateFields(fields: SchemaField[]) {
  const errors: FieldErrors = {};
  const labels = new Map<string, number>();
  fields.forEach((field) =>
    labels.set(
      field.label.trim().toLowerCase(),
      (labels.get(field.label.trim().toLowerCase()) ?? 0) + 1,
    ),
  );
  fields.forEach((field) => {
    const fieldErrors: string[] = [];
    if (!field.label.trim()) fieldErrors.push("Label is required.");
    if (
      field.label.trim() &&
      (labels.get(field.label.trim().toLowerCase()) ?? 0) > 1
    )
      fieldErrors.push("Label must be unique.");
    if (
      optionTypes.has(field.type) &&
      (field.options ?? []).filter(Boolean).length === 0
    )
      fieldErrors.push("Add at least one option.");
    if (field.type === "link_collection_item" && !field.target_collection_slug)
      fieldErrors.push("Choose a target collection.");
    if (fieldErrors.length) errors[field.id] = fieldErrors;
  });
  if (fields.filter((field) => field.indexable).length > 4)
    errors.__form = ["Use at most 4 indexable fields."];
  return errors;
}

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
                onChange({
                  ...field,
                  label: event.target.value,
                  key: fieldKey(event.target.value),
                })
              }
              placeholder="Field label"
            />
            <p className="text-xs text-muted-foreground">key: {field.key}</p>
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
              <Button variant="ghost" size="icon">
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
            <button
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const serialized = useMemo(
    () => JSON.stringify(toJsonSchema(fields)),
    [fields],
  );
  const isDirty = serialized !== initialSchema;

  useEffect(() => {
    if (!user || !slug) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const [{ data: current, error }, { data: allCollections }] =
        await Promise.all([
          supabase
            .from("collections")
            .select("*")
            .eq("user_id", user.id)
            .eq("slug", slug)
            .maybeSingle(),
          supabase
            .from("collections")
            .select("*")
            .eq("user_id", user.id)
            .order("name"),
        ]);
      if (cancelled) return;
      if (error || !current) {
        toast.error("Could not load collection", {
          description: error?.message ?? "Collection not found.",
        });
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
  }, [slug, user]);

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
  const addField = () =>
    setFields((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        key: "new_field",
        label: "New field",
        type: "text",
      },
    ]);
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
      toast.error("Could not save schema", { description: error.message });
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
                  setFields((current) => [
                    ...current,
                    {
                      ...field,
                      id: crypto.randomUUID(),
                      label: `${field.label} copy`,
                      key: fieldKey(`${field.label} copy`),
                      primary: false,
                    },
                  ])
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
