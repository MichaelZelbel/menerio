/**
 * Shared helpers for the unified "Make a copy" action across content types
 * (notes, collection items, moments). Keeping the label, icon and title-suffix
 * rules in one place means a copy behaves identically wherever it is triggered.
 */

export const MAKE_A_COPY_LABEL = "Make a copy";

/**
 * Obsidian-style suffix: append " 1", incrementing if a base already ends in " N"
 * and skipping any titles that already exist in the same container.
 */
export function nextDuplicateTitle(base: string, existing: Set<string>): string {
  const baseTitle = (base || "Untitled").trim();
  const match = baseTitle.match(/^(.*?) (\d+)$/);
  const stem = match ? match[1] : baseTitle;
  let n = match ? parseInt(match[2], 10) + 1 : 1;
  let candidate = `${stem} ${n}`;
  while (existing.has(candidate)) {
    n += 1;
    candidate = `${stem} ${n}`;
  }
  return candidate;
}
