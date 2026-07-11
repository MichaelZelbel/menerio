import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { ProfileFieldFilter } from "../ProfileFieldFilter";

function Harness({ extra }: { extra?: React.ReactNode }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <ProfileFieldFilter value={value} onChange={setValue} />
      {extra}
    </div>
  );
}

function getFilterInput(): HTMLInputElement {
  return screen.getByPlaceholderText("Filter fields… ( / )");
}

describe("ProfileFieldFilter '/' focus shortcut", () => {
  it("focuses the filter input when '/' is pressed on the page body", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(getFilterInput());
    cleanup();
  });

  it("does not steal focus when '/' is typed inside another input", () => {
    render(<Harness extra={<input data-testid="other-input" />} />);
    const other = screen.getByTestId("other-input");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    cleanup();
  });

  it("does not steal focus while a role=\"dialog\" is open", () => {
    render(
      <Harness
        extra={
          <div role="dialog">
            <button data-testid="dialog-button">Cancel</button>
          </div>
        }
      />,
    );
    const button = screen.getByTestId("dialog-button");
    button.focus();
    fireEvent.keyDown(button, { key: "/" });
    expect(document.activeElement).toBe(button);
    cleanup();
  });

  it("does not steal focus while a role=\"alertdialog\" is open (Radix AlertDialog, e.g. delete-category confirmation)", () => {
    render(
      <Harness
        extra={
          <div role="alertdialog">
            <button data-testid="alert-button">Delete</button>
          </div>
        }
      />,
    );
    const button = screen.getByTestId("alert-button");
    button.focus();
    fireEvent.keyDown(button, { key: "/" });
    expect(document.activeElement).toBe(button);
    cleanup();
  });

  it("ignores '/' with a Ctrl/Meta modifier held", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    expect(document.activeElement).not.toBe(getFilterInput());
    cleanup();
  });
});
