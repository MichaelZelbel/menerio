// Where an attribute is shown when nothing more specific says so
// (docs/plans/one-fact-store.md, A2: placeClaim() moves here from adopt-claims.ts).

import { humanizeAttribute } from "./claims.ts";
import {
  canonicalProfileLabel,
  correctProfileCategory,
  matchProfileCategoryByLabel,
} from "./profile-canonical-schema.ts";

/** Section names and icons, as src/lib/profile-taxonomy.ts shows them. */
export const CATEGORY_DISPLAY: Record<string, { name: string; icon: string }> = {
  identity: { name: "Identity & Basics", icon: "user" },
  location: { name: "Location & Living", icon: "map-pin" },
  professional: { name: "Professional Life", icon: "briefcase" },
  education: { name: "Education", icon: "graduation-cap" },
  relationships: { name: "Relationships & Family", icon: "heart" },
  communication: { name: "Contact & Communication", icon: "message-circle" },
  personality: { name: "Personality & Values", icon: "compass" },
  principles: { name: "Principles & Operating System", icon: "book-open" },
  health: { name: "Health & Wellness", icon: "activity" },
  hobbies: { name: "Hobbies & Interests", icon: "palette" },
  food: { name: "Food & Drink", icon: "utensils" },
  entertainment: { name: "Music & Entertainment", icon: "music" },
  travel: { name: "Travel & Experiences", icon: "plane" },
  digital: { name: "Digital Life", icon: "monitor" },
  financial: { name: "Financial", icon: "wallet" },
  goals: { name: "Goals & Aspirations", icon: "target" },
  preferences: { name: "Preferences & Quirks", icon: "sliders-horizontal" },
};

/** Where a claim's attribute is filed when nothing more specific knows it. */
export const FALLBACK_CATEGORY = "preferences";

/** The label and category a claim's attribute is shown under. */
export function placeClaim(attribute: string): { label: string; categorySlug: string } {
  const human = humanizeAttribute(attribute);
  const known = matchProfileCategoryByLabel(human);
  if (known) return { label: known.canonicalLabel, categorySlug: known.slug };
  const label = canonicalProfileLabel("", human) || human;
  return { label, categorySlug: correctProfileCategory(label, FALLBACK_CATEGORY) };
}
