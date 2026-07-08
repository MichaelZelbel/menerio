import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorToolbar } from "../EditorToolbar";

// Simulated formatting-region width, controlled per test. jsdom has no layout
// (offsetWidth is always 0) and no ResizeObserver, so the hook is mocked.
let mockWidth: number | null = null;
vi.mock("@/hooks/useElementWidth", () => ({
  useElementWidth: () => [{ current: null }, mockWidth],
}));

function makeEditor() {
  return new Editor({ extensions: [StarterKit] });
}

afterEach(cleanup);

describe("EditorToolbar (Priority+ layout)", () => {
  it("shows every formatting group and no overflow trigger when wide", () => {
    mockWidth = 2000;
    render(<EditorToolbar editor={makeEditor()} />);

    for (const title of [
      "Undo (Ctrl+Z)",
      "Bold (Ctrl+B)",
      "Bullet list",
      "Numbered list",
      "Checklist",
      "Quote",
      "Align left",
      "Insert link",
      "Insert table",
      "Clear formatting",
    ]) {
      expect(screen.getByTitle(title)).toBeInTheDocument();
    }
    expect(screen.queryByTitle("More formatting")).not.toBeInTheDocument();
  });

  it("collapses low-priority groups into the overflow popover when narrow, keeping lists inline", async () => {
    // Wide enough for structural groups + trigger, not for the mark groups
    // (which collapse early now that the selection bubble menu covers them).
    mockWidth = 520;
    render(<EditorToolbar editor={makeEditor()} />);

    // High-priority groups stay inline.
    expect(screen.getByTitle("Bullet list")).toBeInTheDocument();
    expect(screen.getByTitle("Checklist")).toBeInTheDocument();
    expect(screen.getByTitle("Insert table")).toBeInTheDocument();

    // Bubble-menu-covered and low-priority groups are gone from the row...
    expect(screen.queryByTitle("Bold (Ctrl+B)")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Quote")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Align left")).not.toBeInTheDocument();

    // ...and reachable through the overflow popover.
    const trigger = screen.getByTitle("More formatting");
    fireEvent.click(trigger);
    expect(await screen.findByTitle("Quote")).toBeInTheDocument();
    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
    expect(screen.getByTitle("Align left")).toBeInTheDocument();
  });

  it("never renders formatting groups twice (inline XOR overflow)", () => {
    mockWidth = 520;
    render(<EditorToolbar editor={makeEditor()} />);
    expect(screen.getAllByTitle("Bullet list")).toHaveLength(1);
  });

  it("keeps the pinned note-action slots outside the collapsing region", () => {
    mockWidth = 0; // pathological: everything formatting-side collapses
    render(
      <EditorToolbar
        editor={makeEditor()}
        quickActions={<button title="Add to favorites">star</button>}
        noteActions={<button title="More actions">menu</button>}
      />,
    );
    expect(screen.getByTitle("Add to favorites")).toBeInTheDocument();
    expect(screen.getByTitle("More actions")).toBeInTheDocument();
    expect(screen.getByTitle("More formatting")).toBeInTheDocument();
    expect(screen.queryByTitle("Bold (Ctrl+B)")).not.toBeInTheDocument();
  });
});
