/**
 * Pure helpers for the contact-profile AI quick-add box. Kept free of React and
 * network I/O so the colon-split contract can be unit-tested in isolation.
 */

export type FactInput =
  | { mode: "label"; label: string; value: string }
  | { mode: "text"; text: string };

/**
 * Split a raw quick-add string into an explicit label + value, or fall back to
 * freeform text. The split happens on the FIRST colon only, so
 * `"time: 10:30"` yields label `"time"` / value `"10:30"`. If there is no
 * colon, or either side trims to empty, the whole (trimmed) string is returned
 * as text mode and the server LLM is left to parse it.
 */
export function splitFactInput(raw: string): FactInput {
  const idx = raw.indexOf(":");
  if (idx !== -1) {
    const label = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (label && value) return { mode: "label", label, value };
  }
  return { mode: "text", text: raw.trim() };
}

/** Request body accepted by the `classify-profile-fact` edge function. */
export interface ClassifyFactBody {
  contact_id: string;
  text?: string;
  label?: string;
  value?: string;
}

/**
 * Shape the edge-function request body from a contact id and a raw input:
 * `{label, value}` when the input has a usable `label: value` split, else
 * `{text}` for freeform classification.
 */
export function buildClassifyBody(contactId: string, raw: string): ClassifyFactBody {
  const parsed = splitFactInput(raw);
  if (parsed.mode === "label") {
    return { contact_id: contactId, label: parsed.label, value: parsed.value };
  }
  return { contact_id: contactId, text: parsed.text };
}
