import { describe, it, expect } from "vitest";
import {
  collectPersonNames,
  planPeopleFromNotes,
  describePeopleResult,
} from "../../../supabase/functions/_shared/people-import";

/**
 * Regression: an AI Memory import of person statements left the People page
 * empty. The planner below is what the enrich-people edge function runs, so a
 * fixture of person statements must produce the corresponding people.
 */
describe("planPeopleFromNotes — import fixture with 3 person statements", () => {
  const fixture = [
    {
      id: "n1",
      title: "Nadia prefers bad news early",
      content: "Nadia prefers to hear bad news early and directly.",
      metadata: { type: "person_note", people: ["Nadia"] },
    },
    {
      id: "n2",
      title: "Manager",
      content: "Gunther Reinhard is my manager at Infosys.",
      metadata: { type: "person_note", people: ["Gunther Reinhard"] },
    },
    {
      id: "n3",
      title: "Xihui",
      content: "Xihui is my wife and works in design.",
      metadata: { type: "person_note", people: ["Xihui"] },
    },
  ];

  it("creates one person per statement when the People list is empty", () => {
    const plan = planPeopleFromNotes(fixture, []);
    expect(plan.create.map((p) => p.name).sort()).toEqual(["Gunther Reinhard", "Nadia", "Xihui"]);
    expect(plan.link).toHaveLength(0);
  });

  it("keeps the same name across many notes as one person", () => {
    const repeated = [
      ...fixture,
      { id: "n4", title: "Nadia again", content: "Nadia asked about the roadmap.", metadata: { people: ["nadia"] } },
    ];
    const plan = planPeopleFromNotes(repeated, []);
    const nadia = plan.create.filter((p) => p.name.toLowerCase() === "nadia");
    expect(nadia).toHaveLength(1);
    expect(nadia[0].note_ids).toEqual(["n1", "n4"]);
  });

  it("links to an existing contact instead of creating a duplicate", () => {
    const plan = planPeopleFromNotes(fixture, [
      { id: "c1", name: "Nadia", aliases: [] },
      { id: "c2", name: "Xihui Wang", aliases: ["Xihui"] },
    ]);
    expect(plan.create.map((p) => p.name)).toEqual(["Gunther Reinhard"]);
    expect(plan.link.map((l) => l.contact_id).sort()).toEqual(["c1", "c2"]);
  });

  it("skips names that refer to the user", () => {
    const plan = planPeopleFromNotes(fixture, [], { selfAliases: ["Xihui"] });
    expect(plan.create.map((p) => p.name).sort()).toEqual(["Gunther Reinhard", "Nadia"]);
    expect(plan.skipped[0]).toMatchObject({ reason: "refers to you" });
  });
});

describe("collectPersonNames — fallback when the import produced no metadata", () => {
  it("finds a person in a cued statement", () => {
    expect(
      collectPersonNames({ id: "x", title: "", content: "Gunther Reinhard is my manager." }),
    ).toContain("Gunther Reinhard");
  });

  it("does not invent people from a statement with no person cue", () => {
    expect(collectPersonNames({ id: "x", title: "", content: "Berlin office renovation." })).toEqual([]);
  });
});

describe("describePeopleResult — never silent", () => {
  it("reports created and linked counts", () => {
    expect(describePeopleResult({ created: 2, linked: 1, notes_scanned: 10 })).toBe(
      "Created 2 people, linked 1 existing person to notes.",
    );
  });

  it("gives a plain reason when nothing happened", () => {
    expect(describePeopleResult({ created: 0, linked: 0, notes_scanned: 0 })).toMatch(/no notes were found/i);
    expect(describePeopleResult({ created: 0, linked: 0, notes_scanned: 12 })).toMatch(/none of them named a person/i);
  });
});
