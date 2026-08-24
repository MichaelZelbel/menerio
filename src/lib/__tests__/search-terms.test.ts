import { describe, it, expect } from "vitest";
import {
  extractSearchTerms,
  isTitleHit,
  rankNotesByTerms,
  scoreNote,
  trailingPrefix,
} from "@/lib/search-terms";

describe("extractSearchTerms", () => {
  it("keeps the meaningful terms of a sentence question", () => {
    const terms = extractSearchTerms("how does Nadia want to hear bad news");
    expect(terms).toContain("nadia");
    expect(terms).toContain("bad");
    expect(terms).toContain("news");
    expect(terms).not.toContain("how");
    expect(terms).not.toContain("does");
    expect(terms).not.toContain("to");
  });

  it("does not treat the capitalised first word as a name", () => {
    expect(extractSearchTerms("How is Nadia")).toEqual(["nadia"]);
  });

  it("returns a single noun unchanged", () => {
    expect(extractSearchTerms("Nadia")).toEqual(["nadia"]);
  });
});

describe("trailingPrefix", () => {
  it("exposes the short trailing token of a query being typed", () => {
    expect(trailingPrefix("ownward s")).toBe("s");
  });
  it("is empty once the word is complete or a space was typed", () => {
    expect(trailingPrefix("ownward studio")).toBe("");
    expect(trailingPrefix("ownward ")).toBe("");
  });
});

describe("rankNotesByTerms — sentence query never performs worse than its key noun", () => {
  const notes = [
    { title: "Nadia — feedback style", content: "Nadia prefers bad news early and direct.", updated_at: "2026-08-01" },
    { title: "Rate card", content: "Day rate discussion.", updated_at: "2026-08-02" },
    { title: "1:1 Nadia", content: "Talked about the roadmap.", updated_at: "2026-07-30" },
  ];

  it("returns hits for 'how does Nadia want to hear bad news'", () => {
    const query = "how does nadia want to hear bad news";
    const terms = extractSearchTerms("how does Nadia want to hear bad news");
    const ranked = rankNotesByTerms(notes, query, terms);

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].title).toBe("Nadia — feedback style");
    expect(ranked.map((n) => n.title)).toContain("1:1 Nadia");
    expect(ranked.map((n) => n.title)).not.toContain("Rate card");
  });

  it("never returns fewer notes than the key noun inside the sentence", () => {
    const nounHits = rankNotesByTerms(notes, "nadia", extractSearchTerms("Nadia"));
    const sentenceHits = rankNotesByTerms(
      notes,
      "how does nadia want to hear bad news",
      extractSearchTerms("how does Nadia want to hear bad news"),
    );
    expect(sentenceHits.length).toBeGreaterThanOrEqual(nounHits.length);
  });
});

describe("title coverage beats recency (the 'Ownward Studio' bug)", () => {
  // Real shape of the vault: one short, precise title and many long, newer
  // journal headlines that contain the same phrase.
  const target = { title: "Ownward Studio", content: "The company.", updated_at: "2026-08-17" };
  const journals = [
    "2026-08-21 Every piece is a give; Ownward Studio owns Menerio and Querino",
    "2026-08-16 D-128 Ownward Studio can put a new version of the book in front of buyers",
    "2026-08-06 D-096 Ownward Studio re-founded, and it is running",
    "2026-08-04 D-083: Ownward Studio re-founded on the new kit, and the six faults",
    "2026-08-03 D-077: Ownward Studio's four day-one defects fixed",
    "2026-08-02 D-076 Ownward Studio is live, and founding it broke the script eleven times",
    "2026-07-29 D-056: one excellent opportunity beats four",
    "2026-07-27 D-052: Ownward Studio gets a publisher's mark",
  ].map((title) => ({ title, content: "Ownward Studio journal body.", updated_at: "2026-08-21" }));

  const notes = [...journals, target];

  const rank = (q: string) => rankNotesByTerms(notes, q.toLowerCase(), extractSearchTerms(q));

  it("ranks the exactly-titled note first for the full title", () => {
    expect(rank("Ownward Studio")[0].title).toBe("Ownward Studio");
  });

  it("ranks it first for a single term", () => {
    expect(rank("ownward")[0].title).toBe("Ownward Studio");
  });

  it("ranks it first while the user is still typing ('ownward s')", () => {
    expect(rank("ownward s")[0].title).toBe("Ownward Studio");
  });

  it("finds it through a typo when nothing matches strictly", () => {
    const ranked = rank("onward studio");
    expect(ranked[0].title).toBe("Ownward Studio");
  });

  it("keeps body-only matches below every title match", () => {
    const bodyOnly = { title: "Grocery list", content: "call Ownward Studio", updated_at: "2026-08-23" };
    const ranked = rankNotesByTerms([bodyOnly, target], "ownward", ["ownward"]);
    expect(ranked[0].title).toBe("Ownward Studio");
    expect(scoreNote(bodyOnly, "ownward", ["ownward"]).titleHit).toBe(false);
    expect(isTitleHit(target, "ownward", ["ownward"])).toBe(true);
  });
});
