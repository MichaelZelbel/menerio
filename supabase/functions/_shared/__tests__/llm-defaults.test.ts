import { describe, it, expect } from "vitest";
import {
  CALL_SITE_DEFAULTS,
  CLASSIFY_PROFILE_FACT_PROMPT,
  ENRICH_PERSON_FROM_LEXICON_PROMPT,
  EXTRACT_MOMENT_PROFILE_PROMPT,
  NORMALIZE_PROFILE_PLAN_PROMPT,
  PROCESS_NOTE_FICTION_GUARD_PROMPT,
  getCallSiteDefault,
} from "../llm-defaults.ts";

// Spend audit of 2026-09-11: 31 of 33 registered call sites had max_tokens
// null, and five call sites in code had no row at all. This pins both fixes.

// Not chat calls: the option does not apply, so null is the honest value.
const NON_CHAT = new Set(["analyze-media.ocr", "embeddings.default"]);

// Order the three inline extraction callers carry the taxonomy in. The prompts
// copied into the registry must quote it in this order, not the schema's.
const INLINE_SLUG_ORDER =
  "identity, location, professional, education, relationships, communication, personality, principles, health, hobbies, food, entertainment, travel, digital, financial, goals, preferences";

describe("CALL_SITE_DEFAULTS max_tokens caps", () => {
  it("has no duplicate call_site ids", () => {
    const ids = CALL_SITE_DEFAULTS.map((d) => d.call_site);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps every chat call site with a positive max_tokens", () => {
    for (const d of CALL_SITE_DEFAULTS) {
      if (NON_CHAT.has(d.call_site)) {
        expect(d.system_prompt, d.call_site).toBeNull();
        expect(d.max_tokens, d.call_site).toBeNull();
        continue;
      }
      expect(typeof d.max_tokens, d.call_site).toBe("number");
      expect(d.max_tokens!, d.call_site).toBeGreaterThanOrEqual(300);
      expect(d.max_tokens!, d.call_site).toBeLessThanOrEqual(4000);
    }
  });

  it("keeps the two relationship sites at 2000", () => {
    expect(getCallSiteDefault("relationship.adjudication")?.max_tokens).toBe(2000);
    expect(getCallSiteDefault("relationship.evidence_recovery")?.max_tokens).toBe(2000);
  });
});

describe("call sites that used to run on inline defaults only", () => {
  const expected: Record<string, { prompt: string; maxTokens: number; temperature: number | null }> = {
    "process-note.fiction_guard": { prompt: PROCESS_NOTE_FICTION_GUARD_PROMPT, maxTokens: 800, temperature: null },
    "classify-profile-fact": { prompt: CLASSIFY_PROFILE_FACT_PROMPT, maxTokens: 600, temperature: 0.1 },
    "normalize-profile.plan": { prompt: NORMALIZE_PROFILE_PLAN_PROMPT, maxTokens: 4000, temperature: null },
    "enrich-person-from-lexicon": { prompt: ENRICH_PERSON_FROM_LEXICON_PROMPT, maxTokens: 2500, temperature: null },
    "extract-moment-profile": { prompt: EXTRACT_MOMENT_PROFILE_PROMPT, maxTokens: 2500, temperature: null },
  };

  for (const [site, want] of Object.entries(expected)) {
    it(`registers ${site} with the provider, model and prompt the caller passes inline`, () => {
      const row = getCallSiteDefault(site);
      expect(row).toBeDefined();
      expect(row!.provider).toBe("openrouter");
      expect(row!.model).toBe("deepseek/deepseek-v4-flash");
      expect(row!.system_prompt).toBe(want.prompt);
      expect(row!.system_prompt!.length).toBeGreaterThan(50);
      expect(row!.max_tokens).toBe(want.maxTokens);
      expect(row!.temperature).toBe(want.temperature);
      expect(row!.extra_options).toEqual({ response_format: { type: "json_object" } });
      expect(row!.enabled).toBe(true);
    });
  }

  it("classify-profile-fact declares the contactName placeholder its prompt uses", () => {
    const row = getCallSiteDefault("classify-profile-fact")!;
    expect(row.placeholders).toEqual(["contactName"]);
    expect(row.system_prompt).toContain("{{contactName}}");
  });

  it("quotes the 17 slugs in the order the inline callers use", () => {
    expect(CLASSIFY_PROFILE_FACT_PROMPT).toContain(INLINE_SLUG_ORDER);
    expect(ENRICH_PERSON_FROM_LEXICON_PROMPT).toContain(INLINE_SLUG_ORDER);
    expect(EXTRACT_MOMENT_PROFILE_PROMPT).toContain(INLINE_SLUG_ORDER);
  });

  it("normalize-profile.plan carries the canonical schema description", () => {
    expect(NORMALIZE_PROFILE_PLAN_PROMPT).toContain("- identity:");
    expect(NORMALIZE_PROFILE_PLAN_PROMPT).toContain("(OPEN): keep user labels as-is");
    expect(NORMALIZE_PROFILE_PLAN_PROMPT).toContain("[single]");
  });
});
