import { runChat } from "./llm-router.ts";
import { canonicalLabel } from "./relationship-canonical.ts";

export const RELATIONSHIP_ADJUDICATION_VERSION = "2026-08-09.1";

export type EntityKind = "real_person" | "public_person" | "organization" | "product" | "fictional_character" | "avatar" | "role" | "unclear";
export type AdjudicationOutcome = "keep" | "reject" | "review";

export interface RelationshipCandidate {
  personA: string;
  personB: string;
  label: string;
  inverseLabel?: string | null;
  sourceQuote: string;
  sourceContext?: string;
}

export interface RelationshipAdjudication {
  outcome: AdjudicationOutcome;
  reason: string;
  canonicalLabel: string | null;
  inverseLabel: string | null;
  personAKind: EntityKind;
  personBKind: EntityKind;
  personallyRelevant: boolean;
  relationshipSupported: boolean;
  incidentalOrTransactional: boolean;
  fictionalOrRoleplay: boolean;
  confidence: number;
}

const NON_PERSON_WORDS = /\b(company|corporation|platform|product|app|software|service|project|team|department|brand|server|bot|assistant|avatar|character|role|protagonist|anime|manga|novel|game)\b/i;
const PERSONAL_LABELS = new Set([
  "wife", "husband", "spouse", "partner", "lover", "mother", "father", "parent",
  "son", "daughter", "child", "brother", "sister", "sibling", "friend", "mentor",
  "mentee", "manager", "report", "co-worker", "colleague", "neighbor", "roommate",
  "client", "provider", "teacher", "student", "employer", "employee",
]);

function clampConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function kind(value: unknown): EntityKind {
  const allowed: EntityKind[] = ["real_person", "public_person", "organization", "product", "fictional_character", "avatar", "role", "unclear"];
  return allowed.includes(value as EntityKind) ? value as EntityKind : "unclear";
}

function deterministicRejection(candidate: RelationshipCandidate): RelationshipAdjudication | null {
  const label = canonicalLabel(candidate.label);
  const quote = candidate.sourceQuote.trim();
  if (!quote) return rejected("No exact source quote was supplied", label);
  if (!PERSONAL_LABELS.has(label)) return rejected(`Unsupported relationship role: ${label || candidate.label}`, label);
  if (candidate.personA.trim().toLowerCase() === candidate.personB.trim().toLowerCase()) return rejected("A person cannot have a relationship with the same identity", label);
  if (NON_PERSON_WORDS.test(`${candidate.personA} ${candidate.personB}`) && NON_PERSON_WORDS.test(candidate.sourceContext || quote)) {
    return rejected("At least one endpoint is described as a non-person entity, avatar, fictional character, or role", label);
  }
  return null;
}

function rejected(reason: string, label: string): RelationshipAdjudication {
  return {
    outcome: "reject", reason, canonicalLabel: label || null, inverseLabel: null,
    personAKind: "unclear", personBKind: "unclear", personallyRelevant: false,
    relationshipSupported: false, incidentalOrTransactional: false,
    fictionalOrRoleplay: false, confidence: 1,
  };
}

const SYSTEM_PROMPT = `You are the independent relationship evidence judge for a private personal knowledge base.
Evaluate only the supplied exact quote and context. Never infer a relationship from a name appearing nearby.
A record may be kept only when BOTH endpoints are real people (the account owner counts), the quote supports the proposed personal role, and the relationship is meaningful to the profile owner.
Reject organizations, products, brands, software, projects, bots, fictional characters, avatars, role-play identities, handles without a confirmed person, authors/bylines, celebrities merely discussed, and incidental or one-off transactional mentions.
Professional roles may be kept only when the quote explicitly establishes the durable role between the named people. Do not turn praise, admiration, resemblance, ownership, note authorship, or being the subject of a note into a relationship.
When evidence is ambiguous, choose review rather than keep. Do not assume monogamy or exclusivity; distinct evidenced relationships to distinct real people are valid.
Return strict JSON only with: outcome (keep|reject|review), reason, canonical_label, inverse_label, person_a_kind, person_b_kind, personally_relevant, relationship_supported, incidental_or_transactional, fictional_or_roleplay, confidence (0..1).`;

export async function adjudicateRelationship(args: {
  db: any;
  userId: string;
  candidate: RelationshipCandidate;
}): Promise<RelationshipAdjudication> {
  const deterministic = deterministicRejection(args.candidate);
  if (deterministic) return deterministic;

  try {
    const result = await runChat({
      db: args.db,
      userId: args.userId,
      callSite: "relationship.adjudication",
      defaults: { provider: "lovable", model: "google/gemini-3.6-flash", systemPrompt: SYSTEM_PROMPT, temperature: 0, maxTokens: 500 },
      messages: [{ role: "user", content: JSON.stringify(args.candidate) }],
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = JSON.parse(result.content);
    const aKind = kind(parsed.person_a_kind);
    const bKind = kind(parsed.person_b_kind);
    const supported = parsed.relationship_supported === true;
    const relevant = parsed.personally_relevant === true;
    const fictional = parsed.fictional_or_roleplay === true || [aKind, bKind].some((v) => ["fictional_character", "avatar", "role"].includes(v));
    const nonPerson = [aKind, bKind].some((v) => !["real_person", "public_person"].includes(v));
    let outcome: AdjudicationOutcome = ["keep", "reject", "review"].includes(parsed.outcome) ? parsed.outcome : "review";
    if (fictional || nonPerson || !supported || !relevant || parsed.incidental_or_transactional === true) outcome = outcome === "review" && !fictional && !supported ? "review" : "reject";
    return {
      outcome,
      reason: String(parsed.reason || "Evidence adjudicated"),
      canonicalLabel: canonicalLabel(String(parsed.canonical_label || args.candidate.label)) || null,
      inverseLabel: parsed.inverse_label ? canonicalLabel(String(parsed.inverse_label)) : null,
      personAKind: aKind,
      personBKind: bKind,
      personallyRelevant: relevant,
      relationshipSupported: supported,
      incidentalOrTransactional: parsed.incidental_or_transactional === true,
      fictionalOrRoleplay: fictional,
      confidence: clampConfidence(parsed.confidence),
    };
  } catch (error) {
    console.error("[relationship-adjudicator] failed closed", error);
    return {
      outcome: "review", reason: "Automated evidence review was unavailable", canonicalLabel: canonicalLabel(args.candidate.label) || null,
      inverseLabel: null, personAKind: "unclear", personBKind: "unclear", personallyRelevant: false,
      relationshipSupported: false, incidentalOrTransactional: false, fictionalOrRoleplay: false, confidence: 0,
    };
  }
}

export function exactQuoteExists(noteContent: string, quote: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const needle = normalize(quote);
  return needle.length >= 4 && normalize(noteContent).includes(needle);
}

export async function recoverRelationshipEvidence(args: {
  db: any;
  userId: string;
  noteTitle: string;
  noteContent: string;
  personA: string;
  personB: string;
  label: string;
}): Promise<{ sourceQuote: string; sourceContext: string } | null> {
  const content = args.noteContent.slice(0, 60_000);
  try {
    const result = await runChat({
      db: args.db,
      userId: args.userId,
      callSite: "relationship.evidence_recovery",
      defaults: {
        provider: "lovable",
        model: "google/gemini-3.6-flash",
        temperature: 0,
        maxTokens: 500,
        systemPrompt: `Locate evidence for one proposed person-to-person relationship in a source note. Return strict JSON only: {"source_quote":"...","source_context":"..."}. source_quote must be the shortest exact, verbatim, contiguous quote that explicitly supports the named relationship. source_context may be a larger exact contiguous excerpt. Never paraphrase, repair spelling, combine separate passages, infer from proximity, or use metadata/bylines. If the note does not explicitly support the relationship, return empty strings.`,
      },
      messages: [{
        role: "user",
        content: `Note title: ${args.noteTitle}\nProposed relationship: ${args.personA} is ${args.label} of ${args.personB}\n\nSource note:\n${content}`,
      }],
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = JSON.parse(result.content);
    const sourceQuote = String(parsed.source_quote || "").trim();
    const sourceContext = String(parsed.source_context || "").trim();
    if (!exactQuoteExists(content, sourceQuote)) return null;
    return {
      sourceQuote,
      sourceContext: exactQuoteExists(content, sourceContext) ? sourceContext : sourceQuote,
    };
  } catch (error) {
    console.error("[relationship-evidence-recovery] failed closed", error);
    return null;
  }
}

export function noteContentHash(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}