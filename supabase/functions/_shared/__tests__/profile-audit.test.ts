import { describe, it, expect } from "vitest";
import {
  buildAuditUserMessage,
  entriesFingerprint,
  isProtected,
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
    expect(rejected[0].reason).toBe("all_protected");
  });
});

// The 2026-08-30 loop. `rank: "preferred"` means a human typed the row, and the
// database silently refuses a background job's DELETE of it and silently restores
// its wording on UPDATE. The planner used to be blind to that, so it proposed the
// same impossible merge 1,049 times over 52 hours and the RPC reported success
// every time. These tests are what stop that returning.
describe("planMerges — hand-typed rows the database will not let a job touch", () => {
  it("never puts a preferred entry in removeIds", () => {
    const entries = [
      entry({ id: "keep", label: "Favorite restaurants", value: "anything in kfc", rank: "preferred" }),
      entry({ id: "dupe", label: "Favorite restaurants", value: "kfc" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["keep", "dupe"], label: "Favorite restaurants", value: "anything in kfc" },
    ]);
    expect(rejected).toEqual([]);
    expect(merges).toHaveLength(1);
    expect(merges[0].keepId).toBe("keep");
    expect(merges[0].removeIds).toEqual(["dupe"]);
  });

  it("rejects a group where every entry is protected", () => {
    const entries = [
      entry({ id: "a", value: "one", rank: "preferred" }),
      entry({ id: "b", label: "Aka", value: "one", rank: "preferred" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["a", "b"], label: "Nickname", value: "one" },
    ]);
    expect(merges).toEqual([]);
    expect(rejected[0].reason).toBe("all_protected");
  });

  // The exact production case: the merged value carries "fast food lover", which
  // the hand-typed keeper does not say and a machine cannot add to it. Applying
  // it would delete the only row holding that detail.
  it("rejects a merge whose value a protected keeper can never carry", () => {
    const entries = [
      entry({ id: "pref", label: "Favorite restaurants", value: "anything in kfc", rank: "preferred" }),
      entry({ id: "norm", label: "Dietary style", value: "fast food lover, anything in kfc" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      {
        ids: ["pref", "norm"],
        label: "Dietary style",
        value: "fast food lover, anything in kfc",
      },
    ]);
    expect(merges).toEqual([]);
    expect(rejected[0].reason).toBe("protected_value_immutable");
  });

  it("still merges when the protected keeper's own wording already covers the group", () => {
    const entries = [
      entry({ id: "pref", label: "Employer", value: "Zelbel Ltd London", rank: "preferred" }),
      entry({ id: "norm", label: "Employer", value: "Zelbel Ltd" }),
    ];
    const { merges, rejected } = planMerges(entries, [
      { ids: ["pref", "norm"], label: "Employer", value: "Zelbel Ltd London office" },
    ]);
    expect(rejected).toEqual([]);
    expect(merges).toHaveLength(1);
    // The keeper's existing words win, because a job cannot rewrite them.
    expect(merges[0].keepId).toBe("pref");
    expect(merges[0].value).toBe("Zelbel Ltd London");
    expect(merges[0].removeIds).toEqual(["norm"]);
  });

  it("planExactDuplicates keeps the preferred row and removes the machine copy", () => {
    const plan = planExactDuplicates([
      entry({ id: "machine", label: "Nickname", value: "Chocola", created_at: "2026-01-01T00:00:00Z" }),
      entry({ id: "human", label: "nickname", value: "chocola.", created_at: "2026-05-01T00:00:00Z", rank: "preferred" }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].keepId).toBe("human");
    expect(plan[0].removeIds).toEqual(["machine"]);
  });

  it("marks only protected entries in the prompt, so the model can avoid them", () => {
    const msg = buildAuditUserMessage("Michael", [
      entry({ id: "a", value: "plain" }),
      entry({ id: "b", value: "typed", rank: "preferred" }),
      entry({ id: "c", value: "held", is_pinned: true }),
    ]);
    expect(msg).toContain("id=a | category=identity | label=Nickname | value=plain\n");
    expect(msg).toContain("id=b | category=identity | label=Nickname | value=typed | protected");
    expect(msg).toContain("id=c | category=identity | label=Nickname | value=held | protected");
  });
});

describe("entriesFingerprint", () => {
  it("is unchanged by read order", () => {
    const a = entry({ id: "a", value: "one" });
    const b = entry({ id: "b", value: "two" });
    expect(entriesFingerprint([a, b])).toBe(entriesFingerprint([b, a]));
  });

  it("changes when a value changes", () => {
    const before = [entry({ id: "a", value: "one" })];
    const after = [entry({ id: "a", value: "two" })];
    expect(entriesFingerprint(before)).not.toBe(entriesFingerprint(after));
  });

  it("changes when a row is removed, which is what real progress looks like", () => {
    const before = [entry({ id: "a", value: "one" }), entry({ id: "b", value: "two" })];
    const after = [entry({ id: "a", value: "one" })];
    expect(entriesFingerprint(before)).not.toBe(entriesFingerprint(after));
  });
});

describe("isProtected", () => {
  it("covers both the explicit pin and the automatic hand-typed rank", () => {
    expect(isProtected(entry({ id: "a" }))).toBe(false);
    expect(isProtected(entry({ id: "a", is_pinned: true }))).toBe(true);
    expect(isProtected(entry({ id: "a", rank: "preferred" }))).toBe(true);
    expect(isProtected(entry({ id: "a", rank: "normal" }))).toBe(false);
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
