// Label and value clean-up for a fact on its way in (docs/plans/one-fact-store.md, 3.5).
//
// Moved from normalize-profile's writeProfileEntrySafely so that every writer
// (the page, the note pipeline, moments, lexicon, the review queue, MCP) runs
// the same guards before writeFact() plans anything: canonical label and
// section, the name guard, blocked labels and the skill guard. Pure.

import {
  canonicalProfileLabel,
  correctProfileCategory,
  isBlockedProfileLabel,
} from "./profile-canonical-schema.ts";
import { isSkillLabel, routeSkillValue } from "./profile-skill-guard.ts";
import { guardNameValue, isNameLabel } from "./profile-name-guard.ts";

export interface CleanFact {
  categorySlug: string;
  label: string;
  value: string;
}

export type CleanResult = { ok: true; fact: CleanFact } | { ok: false; reason: "empty_after_guards" | "blocked_label" | "not_a_skill" };

/** Canonical label and section, and the name guard (same rules as the extractor). */
export function normalizeIncomingFact(categorySlug: string, label: string, value: string): CleanFact {
  let nextSlug = categorySlug;
  let nextLabel = label.trim();
  let nextValue = value.trim();
  const booleanValues = new Set(["true", "yes", "y", "x", "✓", "✔"]);
  const lowerValue = nextValue.toLowerCase();
  const diagnosisMatch = nextLabel.match(/^diagnosis\s*:\s*(.+)$/i);

  if (nextSlug === "health" && diagnosisMatch?.[1]?.trim()) {
    nextLabel = "Health conditions";
    nextValue = diagnosisMatch[1].trim();
  } else if (nextSlug === "health" && booleanValues.has(lowerValue) && nextLabel.length <= 60 && !/[:{}]/.test(nextLabel)) {
    nextValue = nextLabel;
    nextLabel = "Health conditions";
  }

  nextSlug = correctProfileCategory(nextLabel, nextSlug);
  nextLabel = canonicalProfileLabel(nextSlug, nextLabel);
  nextSlug = correctProfileCategory(nextLabel, nextSlug);

  if (isNameLabel(nextLabel)) {
    const members = nextValue.split(/\s*,\s*/).map((m) => m.trim()).filter(Boolean);
    const kept: string[] = [];
    const handles: string[] = [];
    for (const member of members) {
      const decision = guardNameValue({ label: nextLabel, value: member });
      if (decision.action === "drop") continue;
      if (decision.action === "relabel") handles.push(decision.value);
      else kept.push(decision.value);
    }
    if (kept.length > 0) {
      nextValue = kept.join(", ");
    } else if (handles.length > 0) {
      nextSlug = "communication";
      nextLabel = "Online handle";
      nextValue = handles.join(", ");
    } else {
      nextValue = "";
    }
  }

  return { categorySlug: nextSlug, label: nextLabel, value: nextValue };
}

/** Every guard a fact passes before it is planned. */
export function cleanIncomingFact(categorySlug: string, label: string, value: string): CleanResult {
  const fact = normalizeIncomingFact(categorySlug || "preferences", label, value);
  if (!fact.value.trim()) return { ok: false, reason: "empty_after_guards" };
  // Relationship edges, purchases and the retired address blob never become facts.
  if (isBlockedProfileLabel(fact.label)) return { ok: false, reason: "blocked_label" };
  // A person, product, language or bare topic is not a skill.
  if (isSkillLabel(fact.label)) {
    const kept = routeSkillValue(fact.value).filter((r) => r.action === "keep").map((r) => r.member);
    if (kept.length === 0) return { ok: false, reason: "not_a_skill" };
    fact.value = kept.join(", ");
  }
  return { ok: true, fact };
}
