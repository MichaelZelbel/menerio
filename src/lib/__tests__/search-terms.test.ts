import { describe, it, expect } from "vitest";
import { extractSearchTerms, rankNotesByTerms } from "@/lib/search-terms";

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
