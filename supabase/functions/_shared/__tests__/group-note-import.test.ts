import { describe, expect, it } from "vitest";
import { previewGroupMembersFromNotes } from "../group-note-import";

const group = { id: "g1", name: "Dream 100" };
const table = (header: string, rows: string[]) =>
  [`| ${header} |`, "| --- |", ...rows.map((r) => `| ${r} |`)].join("\n");

describe("previewGroupMembersFromNotes", () => {
  it("ignores a table note that has nothing to do with the group", () => {
    const shopping = { id: "n1", title: "Einkauf", content: table("Artikel", ["Milch", "Eier"]) };
    expect(previewGroupMembersFromNotes(group, [shopping])).toBeNull();
  });

  it("imports the table from a note named after the group", () => {
    const list = { id: "n2", title: "Dream 100 list", content: table("Name", ["Ada Lovelace", "Grace Hopper"]) };
    const preview = previewGroupMembersFromNotes(group, [list]);
    expect(preview?.note.id).toBe("n2");
    expect(preview?.rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });
});
