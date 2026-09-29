import DOMPurify from "dompurify";

/**
 * Sanitizer for a note shown to the public at /shared/<token>.
 *
 * The note's owner controls its HTML completely (any account can write any HTML
 * into its own notes through the API, a capture bot or the AI tools), and the
 * page is served from the app's own domain. DOMPurify's default HTML profile
 * removes script, but keeps <form action="https://...">, <input>, <button> and
 * free `style`, which is enough to restyle the whole page into a sign-in form
 * that posts a visitor's password elsewhere, with the browser's password
 * manager offering to fill it in because the domain is ours.
 *
 * So: no form controls except the read-only checkbox of a task list, and
 * inline style only for the declarations the editor itself writes (text
 * colour, highlight, alignment). Positioning, sizes and backgrounds, which an
 * overlay needs, are dropped.
 */

const FORBID_TAGS = ["form", "button", "textarea", "select", "option", "optgroup", "datalist", "fieldset", "style", "link", "meta", "base", "dialog"];
const FORBID_ATTR = ["action", "formaction", "form", "autofocus"];
const ALLOWED_STYLE = new Set(["color", "background-color", "text-align"]);
// Declarations whose value could fetch or run something are refused whatever the property.
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|var\s*\(/i;

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  // A private instance, so these hooks never change sanitizing elsewhere.
  const p = DOMPurify(window);
  p.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;
    const kept = data.attrValue
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => {
        const colon = decl.indexOf(":");
        if (colon < 1) return false;
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const value = decl.slice(colon + 1);
        return ALLOWED_STYLE.has(prop) && !UNSAFE_STYLE_VALUE.test(value);
      });
    if (kept.length === 0) data.keepAttr = false;
    else data.attrValue = kept.join("; ");
  });
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "INPUT") return;
    const input = node as HTMLInputElement;
    if ((input.getAttribute("type") || "").toLowerCase() !== "checkbox") {
      input.remove();
      return;
    }
    input.setAttribute("disabled", "");
    input.removeAttribute("name");
  });
  purifier = p;
  return p;
}

export function sanitizeSharedNoteHtml(html: string): string {
  return getPurifier().sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
  }) as string;
}
