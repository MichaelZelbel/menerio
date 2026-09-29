// Pure helpers for the collection schema editor (CollectionSchema page).
//
// Kept free of React and Supabase so the rules that protect saved data can be
// unit-tested directly. The one that matters most: a field's `key` is where
// every item stores its value, so once a field has been saved its key never
// changes, whatever its label becomes. Only a field added in the current
// editing session (isNew) still derives its key from its label.

import type { Json } from "@/integrations/supabase/types";

export type FieldType =
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

export type SchemaField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  indexable?: boolean;
  options?: string[];
  target_collection_slug?: string | null;
  /**
   * Added in this editing session and not saved yet, so no item stores a
   * value under its key and the key may still follow the label. Never
   * written to the database (toJsonSchema drops it).
   */
  isNew?: boolean;
};

export type FieldErrors = Record<string, string[]>;

export const indexableTypes = new Set<FieldType>(["date", "number", "select"]);
export const optionTypes = new Set<FieldType>(["select", "multiselect"]);

export function fieldKey(label: string) {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

export const defaultField = (): SchemaField => ({
  id: crypto.randomUUID(),
  key: "name",
  label: "Name",
  type: "text",
  primary: true,
  isNew: true,
});

export function newField(): SchemaField {
  return {
    id: crypto.randomUUID(),
    key: "new_field",
    label: "New field",
    type: "text",
    isNew: true,
  };
}

/** A copy of `field`. It is new, so its key follows its label. */
export function duplicateField(field: SchemaField): SchemaField {
  const label = `${field.label} copy`;
  return {
    ...field,
    id: crypto.randomUUID(),
    label,
    key: fieldKey(label),
    primary: false,
    isNew: true,
  };
}

/**
 * Change a field's label. A saved field keeps its key: renaming "Price" to
 * "Price ($)" must not move every item's value to a key nothing reads.
 */
export function relabelField(field: SchemaField, label: string): SchemaField {
  return { ...field, label, key: field.isNew ? fieldKey(label) : field.key };
}

export function parseSchema(value: Json): SchemaField[] {
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

export function toJsonSchema(fields: SchemaField[]): Json[] {
  return fields.map(({ id: _id, isNew: _isNew, ...field }) => {
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

export function normalizePrimary(fields: SchemaField[]) {
  if (fields.some((field) => field.primary)) return fields;
  const fallback = fields.find((field) => field.type === "text") ?? fields[0];
  return fields.map((field) => ({
    ...field,
    primary: field.id === fallback?.id,
  }));
}

export function validateFields(fields: SchemaField[]) {
  const errors: FieldErrors = {};
  const labels = new Map<string, number>();
  const keys = new Map<string, number>();
  fields.forEach((field) => {
    const label = field.label.trim().toLowerCase();
    labels.set(label, (labels.get(label) ?? 0) + 1);
    keys.set(field.key, (keys.get(field.key) ?? 0) + 1);
  });
  fields.forEach((field) => {
    const fieldErrors: string[] = [];
    if (!field.label.trim()) fieldErrors.push("Label is required.");
    if (
      field.label.trim() &&
      (labels.get(field.label.trim().toLowerCase()) ?? 0) > 1
    )
      fieldErrors.push("Label must be unique.");
    // Two fields with one key would read and write the same stored value
    // ("Price" and "Price ($)" both become "price").
    else if ((keys.get(field.key) ?? 0) > 1)
      fieldErrors.push(
        field.isNew
          ? `Another field already uses the key "${field.key}". Choose a different label.`
          : `Another field already uses the key "${field.key}".`,
      );
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
