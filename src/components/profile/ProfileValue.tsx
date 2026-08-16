import type { ReactNode } from "react";
import { isCharacterLabel, titleCaseCharacterName } from "@/lib/profile-list-labels";

/**
 * The ONLY place a profile value is turned into pixels. Given the values that
 * belong to one label, it renders a bulleted list for 2+ values and plain
 * text for a single value. Every profile surface (contact facts, own profile,
 * pinned chips, quick-add preview) renders through this, so a multi-value
 * field can never again show up as one comma-separated line on some screens
 * and as bullets on others.
 */
export function ProfileValue({
  label,
  values,
  renderText,
  itemActions,
}: {
  label: string;
  values: string[];
  /** Optional decorator (search highlighting) applied to every value. */
  renderText?: (text: string) => ReactNode;
  /** Optional per-value hover actions, rendered at the end of each bullet. */
  itemActions?: (index: number) => ReactNode;
}) {
  const display = (v: string) => (isCharacterLabel(label) ? titleCaseCharacterName(v) : v);
  const text = (v: string) => (renderText ? renderText(display(v)) : display(v));

  if (values.length === 0) return null;

  if (values.length === 1 && !itemActions) {
    return <span className="text-sm break-words">{text(values[0])}</span>;
  }

  if (values.length === 1) {
    return (
      <span className="flex w-full items-center gap-2 text-sm break-words">
        <span className="min-w-0 break-words">{text(values[0])}</span>
        {itemActions?.(0)}
      </span>
    );
  }

  return (
    <ul className="text-sm break-words w-full list-disc pl-5 space-y-0.5 marker:text-muted-foreground">
      {values.map((v, i) => (
        <li key={`${v}-${i}`} className="group/item flex items-center gap-2">
          <span className="min-w-0 break-words">{text(v)}</span>
          {itemActions?.(i)}
        </li>
      ))}
    </ul>
  );
}
