import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoteMetadataEditor } from "../NoteMetadataEditor";

// Regressions from the notes review of 2026-09-29:
// - Each edit was merged onto the saved metadata, which only changes after the
//   save round trip, so removing two topics quickly resent the first one and it
//   came back.
// - The topic chip is lowercased, and that lowercased text was passed to
//   removeTag, so a tag stored as "Work" could not be removed.
// - A matched person opened the People list, not the person, and the badge was
//   a clickable div a keyboard could not reach.

type Meta = Record<string, unknown>;

function mount(props: { noteId?: string; metadata: Meta | null; tags?: string[] }) {
  const onUpdate = vi.fn();
  const onRemoveTag = vi.fn();
  const onAddTag = vi.fn();
  const ui = (p: { noteId?: string; metadata: Meta | null; tags?: string[] }) => (
    <MemoryRouter>
      <NoteMetadataEditor
        noteId={p.noteId ?? "n1"}
        metadata={p.metadata}
        tags={p.tags ?? []}
        onUpdate={onUpdate}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />
    </MemoryRouter>
  );
  const view = render(ui(props));
  return {
    onUpdate,
    onRemoveTag,
    rerender: (p: { noteId?: string; metadata: Meta | null; tags?: string[] }) => view.rerender(ui(p)),
  };
}

const lastUpdate = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as Meta;

beforeEach(() => {
  // Open the panel (sticky preference) so its contents render.
  window.localStorage.setItem("menerio.panelPrefs.note-metadata", "true");
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("NoteMetadataEditor", () => {
  it("accumulates quick edits before the first save comes back", () => {
    const { onUpdate } = mount({ metadata: { type: "idea", topics: ["alpha", "beta", "gamma"] } });

    fireEvent.click(screen.getByRole("button", { name: "Remove topic alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove topic beta" }));

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(lastUpdate(onUpdate)).toEqual({ type: "idea", topics: ["gamma"] });
    // The panel shows the edits straight away.
    expect(screen.queryByText("#alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("#beta")).not.toBeInTheDocument();
    expect(screen.getByText("#gamma")).toBeInTheDocument();
  });

  it("keeps a newer edit when an older save's echo arrives in between", () => {
    const { onUpdate, rerender } = mount({ metadata: { topics: ["alpha", "beta", "gamma"] } });

    fireEvent.click(screen.getByRole("button", { name: "Remove topic alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove topic beta" }));
    // The first save lands: it still carries beta.
    rerender({ metadata: { topics: ["beta", "gamma"] } });
    expect(screen.queryByText("#beta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove topic gamma" }));
    expect(lastUpdate(onUpdate)).toEqual({ topics: [] });

    // The later saves land; the panel settles on the saved value.
    rerender({ metadata: { topics: ["gamma"] } });
    rerender({ metadata: { topics: [] } });
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();

    // Once acknowledged, a change made elsewhere shows as saved.
    rerender({ metadata: { topics: ["from-ai"] } });
    expect(screen.getByText("#from-ai")).toBeInTheDocument();
  });

  it("does not carry unsaved edits over to another note", () => {
    const { rerender } = mount({ metadata: { topics: ["alpha", "beta"] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove topic alpha" }));

    rerender({ noteId: "n2", metadata: { topics: ["alpha"] } });
    expect(screen.getByText("#alpha")).toBeInTheDocument();
  });

  it("removes a tag by its stored spelling", () => {
    const { onRemoveTag } = mount({ metadata: { topics: [] }, tags: ["Work"] });

    fireEvent.click(screen.getByRole("button", { name: "Remove topic work" }));
    expect(onRemoveTag).toHaveBeenCalledWith("Work");
  });

  it("links a matched person to their own page, reachable by keyboard", () => {
    mount({
      metadata: {
        people: ["Anna"],
        matched_people: [{ name: "Anna", contact_id: "c-42", canonical_name: "Anna Example" }],
      },
    });

    const link = screen.getByRole("link", { name: "@Anna Example" });
    expect(link).toHaveAttribute("href", "/dashboard/people/c-42");
  });
});
