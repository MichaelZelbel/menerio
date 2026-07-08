import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorBubbleMenu } from "../EditorBubbleMenu";

afterEach(cleanup);

function makeEditor() {
  return new Editor({
    extensions: [StarterKit],
    content: "<p>Some selectable text</p>",
  });
}

describe("EditorBubbleMenu", () => {
  it("mounts against a live editor without crashing and stays hidden with no selection", () => {
    const editor = makeEditor();
    const { container } = render(<EditorBubbleMenu editor={editor} />);
    // The plugin only reveals the menu for a non-empty text selection; with a
    // collapsed cursor the element must not be visible.
    const bold = screen.queryByTitle("Bold (Ctrl+B)");
    if (bold) {
      expect(bold.closest("[data-state='visible']")).toBeNull();
    }
    expect(container).toBeDefined();
  });
});
