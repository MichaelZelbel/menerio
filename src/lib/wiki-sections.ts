// Helpers for splitting a Lexicon page's markdown into ## sections and
// computing which sections changed between two versions.

export type WikiSection = { slug: string; heading: string; body: string };

export const INTRO_SLUG = "__intro__";

function slugifyHeading(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** Parse markdown into sections delimited by `## ` headings. Content before
 * the first `##` heading is returned as a section with slug INTRO_SLUG. */
export function parseSections(markdown: string): WikiSection[] {
  const text = (markdown || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const sections: WikiSection[] = [];
  let current: WikiSection = { slug: INTRO_SLUG, heading: "", body: "" };
  const buf: string[] = [];

  const flush = () => {
    current.body = buf.join("\n").replace(/\n+$/, "");
    if (current.slug !== INTRO_SLUG || current.body.trim().length > 0) {
      sections.push(current);
    }
    buf.length = 0;
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      const heading = m[1].trim();
      current = { slug: slugifyHeading(heading), heading, body: "" };
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function normalize(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Returns slugs of sections that changed (or were added) between previous
 * and next markdown. */
export function diffChangedSectionSlugs(previous: string, next: string): string[] {
  const prev = new Map(parseSections(previous).map((s) => [s.slug, normalize(s.body)]));
  const changed: string[] = [];
  for (const section of parseSections(next)) {
    const prevBody = prev.get(section.slug);
    if (prevBody === undefined || prevBody !== normalize(section.body)) {
      changed.push(section.slug);
    }
  }
  return changed;
}

/** Merge an AI-proposed markdown into the current markdown, keeping any
 * section listed in `protectedSlugs` exactly as it is in `current`. New
 * sections from `proposed` that don't exist in `current` are appended. */
export function mergeWithProtectedSections(
  current: string,
  proposed: string,
  protectedSlugs: string[],
): string {
  const protectedSet = new Set(protectedSlugs);
  const currentSections = parseSections(current);
  const proposedSections = parseSections(proposed);
  const currentBySlug = new Map(currentSections.map((s) => [s.slug, s]));
  const proposedBySlug = new Map(proposedSections.map((s) => [s.slug, s]));

  const out: WikiSection[] = [];
  const seen = new Set<string>();

  // Preserve order from proposed (AI's sense of structure), but for any
  // protected slug fall back to the current body.
  for (const section of proposedSections) {
    seen.add(section.slug);
    if (protectedSet.has(section.slug) && currentBySlug.has(section.slug)) {
      out.push(currentBySlug.get(section.slug)!);
    } else {
      out.push(section);
    }
  }

  // Re-add protected sections that the AI dropped entirely.
  for (const slug of protectedSlugs) {
    if (!seen.has(slug) && currentBySlug.has(slug)) {
      out.push(currentBySlug.get(slug)!);
      seen.add(slug);
    }
  }

  // Render
  const parts: string[] = [];
  for (const section of out) {
    if (section.slug === INTRO_SLUG) {
      if (section.body.trim()) parts.push(section.body.trim());
    } else {
      parts.push(`## ${section.heading}\n${section.body}`.trimEnd());
    }
  }
  return parts.join("\n\n").trim() + "\n";
}
