import { describe, expect, it } from "vitest";
import { buildFolderListing, captureTitle, findRelatedNotes, formatCaptureReceipt, mergeTags, type CaptureReceipt } from "../note-filing";
import { memoryDb, type Row } from "./memory-db";

describe("captureTitle", () => {
  it("uses the title it was given, tidied", () => {
    expect(captureTitle("body", "  Blood   test\nresults ")).toBe("Blood test results");
  });
  it("falls back to the first line exactly as capture_note always has", () => {
    expect(captureTitle("First line\nsecond", undefined)).toBe("First line");
    expect(captureTitle("x".repeat(100), "")).toBe("x".repeat(77) + "...");
  });
  it("caps a runaway title", () => {
    expect(captureTitle("b", "t".repeat(500))).toHaveLength(200);
  });
});

describe("mergeTags", () => {
  it("puts the caller's tags first and drops repeats whatever the case", () => {
    expect(mergeTags(["Health", " labs "], ["health", "blood"])).toEqual(["Health", "labs", "blood"]);
  });
  it("keeps the AI topics when no tags were given, as before", () => {
    expect(mergeTags(undefined, ["a", "b"])).toEqual(["a", "b"]);
  });
  it("ignores junk and caps the list", () => {
    expect(mergeTags(["", "  ", null], "nope")).toEqual([]);
    expect(mergeTags(Array.from({ length: 30 }, (_, i) => `t${i}`), [])).toHaveLength(20);
  });
});

describe("findRelatedNotes", () => {
  const USER = "user-a";
  const note = (id: string, over: Row = {}): Row => ({ id, user_id: USER, title: id, is_trashed: false, ai_visibility: "visible", source_app: "web", ...over });
  const dbWith = (notes: Row[], chunks: Row[]) => memoryDb({ notes }, { match_note_chunks: () => ({ data: chunks, error: null }) });

  it("lists the closest existing notes, best first, never the new note itself", async () => {
    const db = dbWith([note("new"), note("a"), note("b")], [
      { note_id: "new", similarity: 0.99 }, { note_id: "a", similarity: 0.5 }, { note_id: "b", similarity: 0.8 }, { note_id: "a", similarity: 0.6 },
    ]);
    const related = await findRelatedNotes(db, USER, [0.1], "new");
    expect(related).toEqual([{ id: "b", title: "b", similarity: 0.8 }, { id: "a", title: "a", similarity: 0.6 }]);
    expect(db.rpcCalls[0].args).toMatchObject({ p_user_id: USER, query_embedding: [0.1] });
  });

  it("prefers a native note to a slightly closer godspeed file, and marks Mission Control file", async () => {
    const db = dbWith([note("mine"), note("mirror", { source_app: "godspeed", title: "rules/x.md" })], [
      { note_id: "mirror", similarity: 0.80 }, { note_id: "mine", similarity: 0.70 },
    ]);
    const related = await findRelatedNotes(db, USER, [0.1], "new");
    expect(related.map((r) => r.id)).toEqual(["mine", "mirror"]);
    expect(related[1].title).toBe("rules/x.md [godspeed file]");
    expect(related[1].similarity).toBe(0.80);
  });

  it("leaves out trashed, hidden and foreign notes even if a chunk points at them", async () => {
    const db = dbWith(
      [note("ok"), note("binned", { is_trashed: true }), note("secret", { ai_visibility: "hidden" }), note("theirs", { user_id: "user-b" })],
      ["binned", "secret", "theirs", "ok"].map((id) => ({ note_id: id, similarity: 0.9 })),
    );
    expect((await findRelatedNotes(db, USER, [0.1], "new")).map((r) => r.id)).toEqual(["ok"]);
  });

  it("stops at five, and answers [] instead of throwing when the RPC fails", async () => {
    const many = Array.from({ length: 9 }, (_, i) => note(`n${i}`));
    const db = dbWith(many, many.map((n, i) => ({ note_id: n.id, similarity: 0.9 - i * 0.01 })));
    expect(await findRelatedNotes(db, USER, [0.1], "new")).toHaveLength(5);
    const broken = memoryDb({ notes: [] }, { match_note_chunks: () => ({ data: null, error: { message: "down" } }) });
    expect(await findRelatedNotes(broken, USER, [0.1], "new")).toEqual([]);
  });
});

describe("formatCaptureReceipt", () => {
  const base: CaptureReceipt = {
    noteId: "note-1", title: "Blood test", folderPath: "Health", foldersCreated: [], tags: ["Health"],
    metadata: { type: "reference" }, indexing: "indexed", related: [], wikilinks: { linked: [], unresolved: [] },
  };

  it("states the id, the final title and the folder", () => {
    const t = formatCaptureReceipt(base);
    expect(t).toContain("ID: note-1");
    expect(t).toContain("Title: Blood test");
    expect(t).toContain("Folder: Health");
    expect(t).toContain("Tags: Health");
  });

  it("says 'top level' when no folder was given, and names a folder it had to create", () => {
    expect(formatCaptureReceipt({ ...base, folderPath: "" })).toContain("Folder: top level");
    expect(formatCaptureReceipt({ ...base, folderPath: "Health/Labs", foldersCreated: ["Health/Labs"] })).toContain("Folder: Health/Labs (new folder created: Health/Labs)");
  });

  it("lists related notes with title and id, and says linking also happens on its own", () => {
    const t = formatCaptureReceipt({ ...base, related: [{ id: "n2", title: "Cholesterol", similarity: 0.71 }] });
    expect(t).toContain("- Cholesterol (n2), 71% similar");
    expect(t).toContain("Menerio links related notes on its own in the background");
  });

  it("says indexing was deferred for lack of credits and lists nothing", () => {
    const t = formatCaptureReceipt({ ...base, indexing: "deferred_no_credits", related: [{ id: "n2", title: "x", similarity: 0.9 }] });
    expect(t).toContain("out of AI credits");
    expect(t).not.toContain("(n2)");
  });

  it("reports resolved and unresolved wikilinks", () => {
    const t = formatCaptureReceipt({ ...base, wikilinks: { linked: [{ title: "Berlin", note_id: "b1" }], unresolved: ["Nowhere"] } });
    expect(t).toContain("Berlin (b1)");
    expect(t).toContain("Nowhere");
    expect(t).toContain("exact title");
  });
});

describe("buildFolderListing", () => {
  it("counts notes per folder and at the top level, sorted by path", () => {
    const l = buildFolderListing(["Work", "Empty"], ["", "", "Work", "Work/Clients", "Work/Clients", "Health"]);
    expect(l.top_level_notes).toBe(2);
    expect(l.folders).toEqual([
      { path: "Empty", notes: 0, notes_including_subfolders: 0 },
      { path: "Health", notes: 1, notes_including_subfolders: 1 },
      { path: "Work", notes: 1, notes_including_subfolders: 3 },
      { path: "Work/Clients", notes: 2, notes_including_subfolders: 2 },
    ]);
    expect(l.folder_count).toBe(4);
  });

  it("makes the parents of a deep note exist even with no folder row", () => {
    expect(buildFolderListing([], ["A/B/C"]).folders.map((f) => f.path)).toEqual(["A", "A/B", "A/B/C"]);
  });

  it("hides Mission Control mirror tree unless asked, without touching a look-alike", () => {
    const folders = ["godspeed", "godspeed/rules", "Hubris"];
    const notes = ["godspeed/rules", "Godspeed/observations", "Hubris", ""];
    const hidden = buildFolderListing(folders, notes);
    expect(hidden.folders.map((f) => f.path)).toEqual(["Hubris"]);
    expect(hidden.godspeed_mirror_included).toBe(false);
    expect(hidden.top_level_notes).toBe(1);
    const shown = buildFolderListing(folders, notes, true);
    expect(shown.folders.map((f) => f.path)).toEqual(expect.arrayContaining(["godspeed", "godspeed/rules", "Godspeed/observations", "Hubris"]));
    expect(shown.godspeed_mirror_included).toBe(true);
    expect(shown.folders.find((f) => f.path === "godspeed")!.notes_including_subfolders).toBe(1);
  });

  it("normalises slashes the way the note tree does", () => {
    expect(buildFolderListing(["/Work/"], ["Work//Clients/"]).folders.map((f) => f.path)).toEqual(["Work", "Work/Clients"]);
  });
});
