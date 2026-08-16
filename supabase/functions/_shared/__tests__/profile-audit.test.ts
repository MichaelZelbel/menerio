import { describe, it, expect } from "vitest";
import {
  buildAuditUserMessage,
  parseAuditResponse,
  planExactDuplicates,
  planMerges,
  valueCovers,
  type AuditEntry,
} from "../profile-audit.ts";

function entry(partial: Partial<AuditEntry> & { id: string }): AuditEntry {
  return {
    category_slug: "identity",
    label: "Nickname",
    value: "x",
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("valueCovers", () => {
  it("accepts a merged value that contains all tokens of the parts", () => {
    expect(valueCovers("Moved out at 16", "16")).toBe(true);
    expect(valueCovers("Moved out at 16", "moved out at 16")).toBe(true);
  });
  it("rejects a merged value that drops information", () => {
    expect(valueCovers("Moved out", "moved out at 16")).toBe(false);
    expect(valueCovers("Private bakery service", "Infosys Consulting")).toBe(false);
  });
});

describe("parseAuditResponse", () => {
  it("parses fenced json", () => {
    const res = parseAuditResponse('```json\n{"groups":[{"ids":["a","b"],"label":"L","value":"V"}]}\n```');
    expect(res.groups?.length).toBe(1);
  });
  it("survives garbage", () => {
    expect(parseAuditResponse("no json here").groups).toEqual([]);
  });
});

describe("planMerges — real reported failures", () => {
  it('collapses "Age moved out: 16" into "Life events: moved out at 16"', () => {
    const entries = [
      entry({ id: "a", category_slug: "identity", label: "Age moved out", value: "16" }),
      entry({ id: "b", category_slug: "identity", label: "Life events", value: "Moved out at 16", created_at: "2026-01-02T00:00:00Z" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["a", "b"], label: "Life events", value: "Moved out at 16", reason: "same event" },
    ]);
    expect(rejected).toEqual([]);
    expect(merges).toHaveLength(1);
    expect(merges[0].label).toBe("Life events");
    expect(merges[0].value).toBe("Moved out at 16");
    expect(merges[0].removeIds).toEqual(["a"]);
  });

  it("collapses Second job / Additional work / Other occupation", () => {
    const entries = [
      entry({ id: "a", category_slug: "professional", label: "Second job", value: "Private bakery service" }),
      entry({ id: "b", category_slug: "professional", label: "Additional work", value: "Private bakery service" }),
      entry({ id: "c", category_slug: "professional", label: "Other occupation", value: "Private bakery service" }),
    ];
    const { merges } = planMerges(entries, [
      { ids: ["a", "b", "c"], label: "Second job", value: "Private bakery service" },
    ]);
    expect(merges).toHaveLength(1);
    expect(merges[0].removeIds).toHaveLength(2);
  });

  it("collapses the Nickname / Aka / Alternative name cluster", () => {
    const entries = [
      entry({ id: "a", label: "Nickname", value: "Chocola" }),
      entry({ id: "b", label: "Aka", value: "Chocola" }),
      entry({ id: "c", label: "Alternative name", value: "Chocola" }),
    ];
    const { merges } = planMerges(entries, [
      { ids: ["a", "b", "c"], label: "Nickname", value: "Chocola" },
    ]);
    expect(merges[0].keepId).toBe("a");
  });
});

describe("planMerges — guards", () => {
  it("rejects a merge that would lose a distinct value", () => {
    const entries = [
      entry({ id: "a", category_slug: "professional", label: "Employer", value: "Infosys Consulting" }),
      entry({ id: "b", category_slug: "professional", label: "Employer", value: "Zelbel Ltd" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["a", "b"], label: "Employer", value: "Zelbel Ltd" },
    ]);
    expect(merges).toEqual([]);
    expect(rejected[0].reason).toBe("lossy_merge");
  });

  it("rejects an invented label", () => {
    const entries = [
      entry({ id: "a", label: "Nickname", value: "Chocola" }),
      entry({ id: "b", label: "Aka", value: "Chocola" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["a", "b"], label: "Preferred moniker", value: "Chocola" },
    ]);
    expect(merges).toEqual([]);
    expect(rejected[0].reason).toBe("label_not_in_group");
  });

  it("rejects unknown ids and double-claimed ids", () => {
    const entries = [entry({ id: "a" }), entry({ id: "b", label: "Aka" })];
    const plan = planMerges(entries, [
      { ids: ["a", "zzz"], label: "Nickname", value: "x" },
      { ids: ["a", "b"], label: "Nickname", value: "x" },
      { ids: ["a", "b"], label: "Nickname", value: "x" },
    ]);
    expect(plan.rejected[0].reason).toBe("unknown_entry_id");
    expect(plan.merges).toHaveLength(1);
    expect(plan.rejected[1].reason).toBe("id_claimed_twice");
  });

  it("never removes a pinned entry", () => {
    const entries = [
      entry({ id: "a", is_pinned: true }),
      entry({ id: "b", label: "Aka", is_pinned: true }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["a", "b"], label: "Nickname", value: "x" },
    ]);
    expect(merges).toEqual([]);
    expect(rejected[0].reason).toBe("all_pinned");
  });
});

describe("planExactDuplicates", () => {
  it("collapses identical label+value rows without an LLM", () => {
    const entries = [
      entry({ id: "a", label: "Nickname", value: "Chocola" }),
      entry({ id: "b", label: "nickname", value: "chocola.", created_at: "2026-02-01T00:00:00Z" }),
      entry({ id: "c", label: "Nickname", value: "Yumei" }),
    ];
    const plan = planExactDuplicates(entries);
    expect(plan).toHaveLength(1);
    expect(plan[0].keepId).toBe("a");
    expect(plan[0].removeIds).toEqual(["b"]);
  });
});

describe("buildAuditUserMessage", () => {
  it("includes every entry with its id", () => {
    const msg = buildAuditUserMessage("Yumei", [entry({ id: "a" }), entry({ id: "b" })]);
    expect(msg).toContain("id=a");
    expect(msg).toContain("id=b");
    expect(msg).toContain("Entries (2)");
  });
});
