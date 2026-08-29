import { describe, expect, it, vi } from "vitest";
import {
  MAX_NOTES_PER_TURN,
  createNoteCreateSession,
  executeNoteCreateTool,
  loadExistingFolderPaths,
  matchFolderCasing,
  normalizeFolderPath,
  resolveFolderPath,
} from "../note-create-tools.ts";

/**
 * Minimal stand-in for the PostgREST query builder: every chain method returns
 * itself, and the object is awaitable (and `.single()`-able) into a result.
 */
function makeDb(opts: {
  folders?: { path: string }[];
  notes?: { folder_path: string }[];
  insertError?: string;
  upsertError?: string;
} = {}) {
  const state = {
    folders: opts.folders ?? [],
    notes: opts.notes ?? [],
    inserted: [] as Record<string, any>[],
    upserted: [] as Record<string, any>[],
  };

  const chain = (result: unknown) => {
    const p: any = {
      select: () => p,
      eq: () => p,
      neq: () => p,
      limit: () => p,
      single: () => Promise.resolve(result),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return p;
  };

  const db: any = {
    state,
    from(table: string) {
      if (table === "note_folders") {
        return {
          select: () => chain({ data: state.folders, error: null }),
          upsert: (rows: Record<string, any>[]) => {
            if (opts.upsertError) {
              return Promise.resolve({ error: { message: opts.upsertError } });
            }
            state.upserted.push(...rows);
            state.folders.push(...rows.map((r) => ({ path: r.path })));
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "notes") {
        return {
          select: () => chain({ data: state.notes, error: null }),
          insert: (row: Record<string, any>) => {
            state.inserted.push(row);
            return chain(
              opts.insertError
                ? { data: null, error: { message: opts.insertError } }
                : {
                    data: {
                      id: `note-${state.inserted.length}`,
                      title: row.title,
                      folder_path: row.folder_path,
                    },
                    error: null,
                  },
            );
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return db;
}

describe("normalizeFolderPath", () => {
  it("trims each segment and collapses separators", () => {
    expect(normalizeFolderPath("  DeepSeek  ")).toBe("DeepSeek");
    expect(normalizeFolderPath("/A//B/")).toBe("A/B");
    expect(normalizeFolderPath(" DeepSeek / Models ")).toBe("DeepSeek/Models");
  });

  it("accepts backslashes as separators", () => {
    expect(normalizeFolderPath("A\\B")).toBe("A/B");
  });

  it("returns empty for nothing usable", () => {
    expect(normalizeFolderPath("")).toBe("");
    expect(normalizeFolderPath("///")).toBe("");
    expect(normalizeFolderPath(undefined)).toBe("");
    expect(normalizeFolderPath(42)).toBe("");
  });
});

describe("matchFolderCasing", () => {
  it("adopts the casing the user already uses", () => {
    expect(matchFolderCasing("deepseek", ["DeepSeek"])).toBe("DeepSeek");
    expect(matchFolderCasing("DEEPSEEK", ["DeepSeek"])).toBe("DeepSeek");
  });

  it("keeps a known parent's casing and the caller's casing for a new child", () => {
    expect(matchFolderCasing("deepseek/Models", ["DeepSeek"])).toBe("DeepSeek/Models");
  });

  it("matches a whole nested path when it is known", () => {
    expect(
      matchFolderCasing("deepseek/models", ["DeepSeek", "DeepSeek/Models"]),
    ).toBe("DeepSeek/Models");
  });

  it("leaves an entirely new path alone", () => {
    expect(matchFolderCasing("Fresh/Thing", [])).toBe("Fresh/Thing");
  });
});

describe("loadExistingFolderPaths", () => {
  it("includes the implied parents of a note's folder", async () => {
    const db = makeDb({ folders: [], notes: [{ folder_path: "A/B/C" }] });
    expect(await loadExistingFolderPaths(db, "u1")).toEqual(["A", "A/B", "A/B/C"]);
  });

  it("merges the folder table with the folders notes actually sit in", async () => {
    const db = makeDb({ folders: [{ path: "Empty" }], notes: [{ folder_path: "Used" }] });
    expect(await loadExistingFolderPaths(db, "u1")).toEqual(["Empty", "Used"]);
  });
});

describe("resolveFolderPath", () => {
  it("creates a row for every missing segment", async () => {
    const db = makeDb();
    const res = await resolveFolderPath(db, "u1", "A/B");
    expect(res.path).toBe("A/B");
    expect(res.created).toEqual(["A", "A/B"]);
    expect(db.state.upserted).toEqual([
      { user_id: "u1", path: "A", name: "A", parent_path: "" },
      { user_id: "u1", path: "A/B", name: "B", parent_path: "A" },
    ]);
  });

  it("reuses an existing folder instead of making a case-variant twin", async () => {
    const db = makeDb({ folders: [{ path: "DeepSeek" }] });
    const res = await resolveFolderPath(db, "u1", "deepseek");
    expect(res.path).toBe("DeepSeek");
    expect(res.created).toEqual([]);
    expect(db.state.upserted).toEqual([]);
  });

  it("returns the root for an empty request", async () => {
    const db = makeDb();
    expect(await resolveFolderPath(db, "u1", undefined)).toEqual({ path: "", created: [] });
  });

  it("still reports the path when the folder row cannot be written", async () => {
    const db = makeDb({ upsertError: "permission denied" });
    const res = await resolveFolderPath(db, "u1", "A");
    expect(res.path).toBe("A");
    expect(res.created).toEqual([]);
  });
});

describe("executeNoteCreateTool: create_note", () => {
  const args = { title: "Notes on X", content: "line one\nline two", folder: "deepseek" };

  it("creates the note and returns a receipt without the body", async () => {
    const db = makeDb({ folders: [{ path: "DeepSeek" }] });
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", args),
    );

    expect(res.success).toBe(true);
    expect(res.note_id).toBe("note-1");
    expect(res.folder_path).toBe("DeepSeek");
    expect(res.word_count).toBe(4);
    // The body must never travel back into the model's context.
    expect(JSON.stringify(res)).not.toContain("line one");
    expect(session.created).toHaveLength(1);
  });

  it("records provenance on the row", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    await executeNoteCreateTool(db, "u1", session, "create_note", args);
    const row = db.state.inserted[0];
    expect(row.user_id).toBe("u1");
    expect(row.source_app).toBe("ai-chat");
    expect(row.metadata.created_by).toBe("assistant");
  });

  it("triggers the process-note pipeline exactly once per note", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    const onCreated = vi.fn();
    await executeNoteCreateTool(db, "u1", session, "create_note", args, { onCreated });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith("note-1");
  });

  it("does not create the same note twice in one turn", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    await executeNoteCreateTool(db, "u1", session, "create_note", args);
    const second = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", args),
    );
    expect(second.duplicate_call).toBe(true);
    expect(db.state.inserted).toHaveLength(1);
  });

  it("stops at the per-turn cap", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    for (let i = 0; i < MAX_NOTES_PER_TURN; i++) {
      await executeNoteCreateTool(db, "u1", session, "create_note", {
        ...args,
        title: `Note ${i}`,
      });
    }
    const overflow = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", {
        ...args,
        title: "One too many",
      }),
    );
    expect(overflow.error).toBe("limit_reached");
    expect(db.state.inserted).toHaveLength(MAX_NOTES_PER_TURN);
  });

  it("refuses a note with neither title nor content", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", {
        title: "  ",
        content: "",
      }),
    );
    expect(res.error).toBe("empty");
    expect(db.state.inserted).toHaveLength(0);
  });

  it("reports an insert failure instead of claiming success", async () => {
    const db = makeDb({ insertError: "row level security" });
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", args),
    );
    expect(res.error).toBe("insert_failed");
    expect(session.created).toHaveLength(0);
  });

  it("falls back to the first content line when no title is given", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "create_note", {
        title: "",
        content: "First line here\nsecond",
      }),
    );
    expect(res.title).toBe("First line here");
  });
});

describe("executeNoteCreateTool: list_note_folders", () => {
  it("lists what already exists", async () => {
    const db = makeDb({ folders: [{ path: "DeepSeek" }], notes: [{ folder_path: "Ideas" }] });
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "list_note_folders", {}),
    );
    expect(res.folders).toEqual(["DeepSeek", "Ideas"]);
    expect(res.count).toBe(2);
  });
});

describe("executeNoteCreateTool: unknown tool", () => {
  it("returns an error rather than throwing", async () => {
    const db = makeDb();
    const session = createNoteCreateSession();
    const res = JSON.parse(
      await executeNoteCreateTool(db, "u1", session, "trash_note", {}),
    );
    expect(res.error).toContain("Unknown create tool");
  });
});
