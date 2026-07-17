/**
 * Shared helpers for the collection-chat edge function.
 *
 * A collection has a per-user `field_schema` (array of SchemaField) plus a
 * free-form `data` jsonb per item. To make the model useful across arbitrary
 * schemas we (1) render the schema as prose for the system prompt and
 * (2) validate LLM-proposed item data before writing to the DB. The DB has a
 * validate_collection_item_data trigger as a hard backstop.
 */

export type FieldType =
  | "text" | "longtext" | "number" | "date" | "datetime" | "boolean"
  | "select" | "multiselect" | "currency" | "url" | "email" | "phone"
  | "link_note" | "link_person" | "link_collection_item";

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  indexable?: boolean;
  options?: string[];
  target_collection_slug?: string | null;
}

export function renderSchemaForPrompt(schema: SchemaField[]): string {
  const lines = schema.map((f) => {
    const marks: string[] = [];
    if (f.primary) marks.push("primary");
    if (f.options?.length) marks.push(`options: ${f.options.join(" | ")}`);
    if (f.target_collection_slug) marks.push(`links to: ${f.target_collection_slug}`);
    const suffix = marks.length ? ` (${marks.join("; ")})` : "";
    return `- ${f.key} [${f.type}] — ${f.label}${suffix}`;
  });
  return lines.join("\n");
}

const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+/i;
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Validate & coerce a proposed item.data object against a field_schema. */
export function validateItemData(
  data: Record<string, unknown>,
  schema: SchemaField[],
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "data must be an object" };
  }
  const cleaned: Record<string, unknown> = {};
  const allowed = new Set(schema.map((f) => f.key));

  for (const [k, v] of Object.entries(data)) {
    if (!allowed.has(k)) continue; // silently drop unknown keys
    cleaned[k] = v;
  }

  let hasPrimaryValue = false;
  for (const field of schema) {
    const v = cleaned[field.key];
    const isEmpty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (field.primary) {
      if (isEmpty) return { ok: false, error: `primary field "${field.key}" cannot be empty` };
      hasPrimaryValue = true;
    }
    if (isEmpty) { delete cleaned[field.key]; continue; }

    switch (field.type) {
      case "number":
      case "currency": {
        const n = typeof v === "number" ? v : Number(String(v));
        if (!Number.isFinite(n)) return { ok: false, error: `${field.key} must be numeric` };
        cleaned[field.key] = n;
        break;
      }
      case "boolean": {
        if (typeof v !== "boolean") return { ok: false, error: `${field.key} must be true or false` };
        break;
      }
      case "multiselect": {
        if (!Array.isArray(v)) return { ok: false, error: `${field.key} must be a list` };
        cleaned[field.key] = v.map((x) => String(x));
        break;
      }
      case "url": {
        if (!URL_RE.test(String(v))) return { ok: false, error: `${field.key} must be a valid URL` };
        cleaned[field.key] = String(v);
        break;
      }
      case "email": {
        if (!EMAIL_RE.test(String(v))) return { ok: false, error: `${field.key} must be a valid email` };
        cleaned[field.key] = String(v);
        break;
      }
      case "select": {
        const s = String(v);
        if (field.options?.length && !field.options.includes(s)) {
          return { ok: false, error: `${field.key} must be one of: ${field.options.join(", ")}` };
        }
        cleaned[field.key] = s;
        break;
      }
      default: {
        // text, longtext, date, datetime, phone, link_* — accept as-is (string/object)
        break;
      }
    }
  }

  if (!hasPrimaryValue) {
    return { ok: false, error: "primary field is required" };
  }
  return { ok: true, data: cleaned };
}

/** Fetch a URL and return trimmed text (~15KB budget). Used by extract_item_from_url. */
export async function fetchUrlAsText(url: string, maxChars = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Menerio/1.0 (+https://menerio.com)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();
  // Naive HTML -> text; good enough for structured extraction context.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxChars);
}
