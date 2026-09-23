import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GettingStartedChecklist } from "@/components/dashboard/widgets/GettingStartedChecklist";

function renderList(props: { hasProfile: boolean; hasNotes: boolean; hasAiNote?: boolean }) {
  return render(
    <MemoryRouter>
      <GettingStartedChecklist {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

describe("GettingStartedChecklist", () => {
  it("can reach every item: AI processing and the features tour both tick off", () => {
    renderList({ hasProfile: true, hasNotes: true, hasAiNote: true });
    expect(screen.getByText("3/4 completed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Explore features"));
    expect(screen.getByText("4/4 completed")).toBeInTheDocument();
  });

  it("does not tick AI processing before any note was processed", () => {
    renderList({ hasProfile: true, hasNotes: true, hasAiNote: false });
    expect(screen.getByText("2/4 completed")).toBeInTheDocument();
  });
});
