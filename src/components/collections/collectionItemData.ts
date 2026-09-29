// Pure helpers for writing a collection item's `data` object.
//
// An item's data holds more than the fields the editor shows: values under a
// renamed field's old key, `duplicated_from`, and keys written by the AI chat
// or the MCP tools. Rebuilding data from the form alone silently deleted all
// of them on every save.

import type { Json } from "@/integrations/supabase/types";

type DataObject = Record<string, Json>;

// Field types whose value the editor can hold as text. Only these can carry a
// copy's " 2" title suffix without failing the database's type checks.
const TEXT_TYPES = new Set(["text", "longtext"]);

function asObject(value: Json | null | undefined): DataObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as DataObject) }
    : {};
}

/**
 * The data to save: the item's stored data with each field the person changed
 * replaced by the form's value, or removed when the form left it empty. Keys
 * the form did not change, including keys it does not show, stay as stored.
 */
export function mergeItemData(
  existing: Json | null | undefined,
  formData: DataObject,
  changedKeys: Iterable<string>,
): DataObject {
  const next = asObject(existing);
  for (const key of changedKeys) {
    if (Object.prototype.hasOwnProperty.call(formData, key)) next[key] = formData[key];
    else delete next[key];
  }
  return next;
}

/**
 * The data for a copy of an item. The database derives an item's title from
 * its primary field, so the suffixed title ("Book 2") has to be written into
 * that field; a `title` column value alone is overwritten and the copy would
 * carry the original's exact title.
 */
export function duplicateItemData(
  source: Json | null | undefined,
  sourceId: string,
  primaryField: { key: string; type: string } | undefined,
  nextTitle: string | null,
): DataObject {
  const data: DataObject = { ...asObject(source), duplicated_from: sourceId };
  if (primaryField && nextTitle && TEXT_TYPES.has(primaryField.type))
    data[primaryField.key] = nextTitle;
  return data;
}
