import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Note } from "@/hooks/useNotes";
import { NoteTree } from "../NoteTree";

// Regressions from the notes review of 2026-09-29:
// - With no notes and no folders the tree returned the empty state before the
//   Trash row, the only way into Trash, so trashing the last note left it with
//   no way back.
// - A dragged note travelled as text/plain: dropping editor text on a folder
//   tried to move a note whose id was that text, and dropping a note into the
//   editor typed its bare id.

vi.mock("@/hooks/useNotes", () => ({
  useDuplicateNote: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../BulkActionBar", () => ({ BulkActionBar: () => null }));

const note = (over: Partial<Note>): Note =>
  ({
    id: "n1",
    user_id: "u1",
    title: "A note",
    content: "",
    metadata: null,
    tags: [],
    folder_path: "",
    is_favorite: false,
    is_pinned: false,
    is_trashed: false,
    trashed_at: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...over,
  }) as unknown as Note;

function mount(props: { notes?: Note[]; folderPaths?: string[]; trashedNotes?: Note[]; favoriteNotes?: Note[] }) {
  const onMoveNote = vi.fn();
  const onMoveFolder = vi.fn();
  render(
    <MemoryRouter>
      <NoteTree
        notes={props.notes ?? []}
        folderPaths={props.folderPaths ?? []}
        selectedId={null}
        activeFolderPath={null}
        onSelectNote={vi.fn()}
        onSelectFolder={vi.fn()}
        onCreateNoteInFolder={vi.fn()}
        onCreateFolderInFolder={vi.fn()}
        onMoveNote={onMoveNote}
        onMoveFolder={onMoveFolder}
        onRestoreNote={vi.fn()}
        trashedNotes={props.trashedNotes}
        favoriteNotes={props.favoriteNotes}
      />
    </MemoryRouter>,
  );
  return { onMoveNote, onMoveFolder };
}

/** A DataTransfer stand-in: jsdom has none. */
function transfer(data: Record<string, string>) {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? "",
    setData: vi.fn(),
    dropEffect: "none",
    effectAllowed: "all",
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("NoteTree", () => {
  it("keeps Trash reachable after the last note is trashed", () => {
    mount({ trashedNotes: [note({ id: "t1", title: "Last note", is_trashed: true, trashed_at: "2026-09-02T10:00:00Z" })] });

    // The capture empty state is still there...
    expect(screen.getByText("Start capturing your thoughts")).toBeInTheDocument();
    // ...and so is the way into Trash.
    fireEvent.click(screen.getByRole("button", { name: /trash/i }));
    expect(screen.getByText("Last note")).toBeInTheDocument();
  });

  it("shows only the empty state when there is nothing anywhere", () => {
    mount({});
    expect(screen.getByText("Start capturing your thoughts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /trash/i })).not.toBeInTheDocument();
  });

  it("carries a dragged note under its own type, not text/plain", () => {
    mount({ notes: [note({ id: "n1", title: "Drag me" })] });
    const dt = transfer({});
    fireEvent.dragStart(screen.getByText("Drag me").closest("a")!, { dataTransfer: dt });

    const types = dt.setData.mock.calls.map(([type]) => type);
    expect(types).toContain("application/x-note-id");
    expect(types).not.toContain("text/plain");
    expect(dt.setData).toHaveBeenCalledWith("application/x-note-id", "n1");
  });

  it("moves a note dropped on a folder", () => {
    const { onMoveNote } = mount({ notes: [note({ id: "n1" })], folderPaths: ["Projects"] });
    fireEvent.drop(screen.getByText("Projects").closest("button")!, {
      dataTransfer: transfer({ "application/x-note-id": "n1" }),
    });
    expect(onMoveNote).toHaveBeenCalledWith("n1", "Projects");
  });

  it("ignores editor text dropped on a folder", () => {
    const { onMoveNote, onMoveFolder } = mount({ notes: [note({ id: "n1" })], folderPaths: ["Projects"] });
    fireEvent.drop(screen.getByText("Projects").closest("button")!, {
      dataTransfer: transfer({ "text/plain": "some selected words" }),
    });
    expect(onMoveNote).not.toHaveBeenCalled();
    expect(onMoveFolder).not.toHaveBeenCalled();
  });
});
