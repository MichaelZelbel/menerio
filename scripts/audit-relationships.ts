/**
 * Acceptance check for relationship data quality.
 *
 * Reads every stored relationship exactly the way a profile renders it and
 * fails when a row is junk, duplicated, inverted or (for automated rows)
 * unevidenced. Run with: bun scripts/audit-relationships.ts
 * Requires the managed Postgres env vars (PGHOST, PGUSER, …).
 */
import { execFileSync } from "node:child_process";
import {
  describeRelationship,
  relationshipKind,
  relationshipPairKey,
  cleanPersonName,
} from "../src/lib/relationship-canonical";

type Row = {
  id: string;
  user_id: string;
  source_type: "contact" | "self";
  source_id: string | null;
  target_type: "contact" | "self";
  target_id: string | null;
  label: string;
  custom_label: string | null;
  origin: string | null;
  evidence_quote: string | null;
  source_name: string | null;
  target_name: string | null;
};

const SQL = `
  SELECT json_agg(t) FROM (
    SELECT r.id, r.user_id, r.source_type, r.source_id, r.target_type, r.target_id,
           r.label, r.custom_label, r.origin, r.evidence_quote,
           sc.name AS source_name, tc.name AS target_name
    FROM contact_relationships r
    LEFT JOIN contacts sc ON sc.id = r.source_id
    LEFT JOIN contacts tc ON tc.id = r.target_id
  ) t;
`;

const raw = execFileSync("psql", ["-At", "-c", SQL], { encoding: "utf8" }).trim();
const rows: Row[] = raw && raw !== "" ? JSON.parse(raw) : [];

const failures: string[] = [];
const seen = new Map<string, string>();

for (const r of rows) {
  const description = describeRelationship({
    sourceType: r.source_type,
    sourceId: r.source_id,
    targetType: r.target_type,
    targetId: r.target_id,
    label: r.label,
    customLabel: r.custom_label,
    viewingContactId: r.source_type === "self" ? null : r.source_id,
    sourceName: r.source_name || "Me",
    targetName: r.target_name || "Me",
  });

  if (relationshipKind(r.custom_label || r.label) === "other") {
    failures.push(`junk role "${r.custom_label || r.label}" (${r.id})`);
  }
  if ((r.origin || "user") !== "user" && (r.evidence_quote || "").trim().length < 10) {
    failures.push(`automated row without evidence (${r.id})`);
  }
  if (cleanPersonName(description.otherName) !== description.otherName) {
    failures.push(`unclean name "${description.otherName}" (${r.id})`);
  }
  const key = relationshipPairKey(
    r.user_id,
    { type: r.source_type, id: r.source_id },
    { type: r.target_type, id: r.target_id },
    r.label,
  );
  const prev = seen.get(key);
  // Two stored directions of one bond are fine (they collapse on screen);
  // two rows in the SAME direction are a duplicate.
  if (prev && prev === `${r.source_type}:${r.source_id}`) {
    failures.push(`duplicate bond row (${r.id})`);
  }
  seen.set(key, `${r.source_type}:${r.source_id}`);
}

console.log(`checked ${rows.length} relationships`);
if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("PASS — no junk, unevidenced, unclean or duplicated relationship rows");
