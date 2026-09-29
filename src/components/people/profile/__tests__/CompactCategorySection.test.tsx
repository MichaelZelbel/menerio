import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CompactCategorySection } from "../CompactCategorySection";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProfileCategory } from "@/hooks/useProfile";
import { groupFacts, type FactActions, type ProfileFact } from "@/hooks/useFacts";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

const category = (over: Partial<ProfileCategory> = {}): ProfileCategory => ({
  id: "cat-1",
  user_id: "user-1",
  name: "Custom Stuff",
  slug: "custom-stuff",
  icon: "folder",
  description: null,
  sort_order: 0,
  is_default: false,
  visibility_scope: "all",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const fact = (over: Partial<ProfileFact> = {}): ProfileFact => ({
  claim_id: "c1",
  user_id: "user-1",
  subject_type: "contact",
  subject_id: "p1",
  contact_id: "p1",
  attribute: "favorite-color",
  value: "Blue",
  valid_from: null,
  valid_to: null,
  is_current: true,
  confidence: "certain",
  cardinality: "one",
  origin: "user_manual",
  rank: "preferred",
  evidence_quote: null,
  source_type: "manual",
  source_id: null,
  review_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  slot_id: "s1",
  label: "Favorite color",
  category_slug: "custom-stuff",
  category_name: "Custom Stuff",
  visibility_scope: "all",
  is_pinned: false,
  show_to_agent: false,
  has_conflict: false,
  ...over,
});

function renderSection(
  facts: ProfileFact[] = [],
  categoryOver: Partial<ProfileCategory> = {},
  today?: () => string,
) {
  const actions: { [K in keyof FactActions]: ReturnType<typeof vi.fn> } = {
    add: vi.fn(),
    changed: vi.fn(),
    fix: vi.fn(),
    redate: vi.fn(),
    reopen: vi.fn(),
    end: vi.fn(),
    retract: vi.fn(),
    updateSlot: vi.fn(),
    keepOnly: vi.fn(),
    ...(today ? { today: vi.fn(today) } : {}),
  };
  const section = groupFacts(facts, [category(categoryOver)]).find((s) => s.key === "custom-stuff")!;
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CompactCategorySection
          section={section}
          filterQuery=""
          matches={new Map()}
          actions={actions as unknown as FactActions}
          onUpdateCategory={vi.fn()}
          onDeleteCategory={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return actions;
}

/** Radix menus open on keyboard in jsdom (pointer events are not implemented). */
function openMenu(name: string, index = 0) {
  fireEvent.keyDown(screen.getAllByRole("button", { name })[index], { key: "Enter" });
}

describe("CompactCategorySection — empty custom category affordance (regression: custom-category dead end)", () => {
  it("shows a 'no facts yet' hint with an Add button when the rendered section has no facts", () => {
    renderSection();
    expect(screen.getByText("No facts yet. Add one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeInTheDocument();
  });

  it("clicking the hint's Add button opens the add form, which adds through actions.add", () => {
    const actions = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.queryByText("No facts yet. Add one.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g., Favorite book"), { target: { value: "Favorite book" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "Dune" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.add).toHaveBeenCalledWith({
      label: "Favorite book",
      value: "Dune",
      category_slug: "custom-stuff",
      linked_note_id: null,
    });
  });

  it("does not show the empty-state hint once the section has a fact", () => {
    renderSection([fact()]);
    expect(screen.queryByText("No facts yet. Add one.")).not.toBeInTheDocument();
    expect(screen.getByText("Favorite color:")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
  });
});

describe("CompactCategorySection — one line per slot", () => {
  it("shows several current values of one slot on one line", () => {
    renderSection([
      fact({ claim_id: "a", attribute: "languages", label: "Languages", value: "German", cardinality: "many" }),
      fact({ claim_id: "b", attribute: "languages", label: "Languages", value: "English", cardinality: "many", created_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(screen.getAllByText("Languages:")).toHaveLength(1);
    expect(screen.getByText("German")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("lists ended values under History (n)", () => {
    renderSection([
      fact({ claim_id: "a", value: "Blue" }),
      fact({ claim_id: "b", value: "Red", is_current: false, valid_to: "2026-03-01" }),
    ]);
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /History \(1\)/ }));
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText(/until/)).toBeInTheDocument();
  });

  it("pins the whole slot", () => {
    const actions = renderSection([fact()]);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(actions.updateSlot).toHaveBeenCalledWith(expect.objectContaining({ slotId: "s1" }), { is_pinned: true });
  });
});

describe("CompactCategorySection — remove offers No longer true and Was wrong", () => {
  it("No longer true ends the value", () => {
    const actions = renderSection([fact()]);
    openMenu("Remove entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "No longer true" }));
    expect(actions.end).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "c1" }));
    expect(actions.retract).not.toHaveBeenCalled();
  });

  it("Was wrong asks first, then retracts", () => {
    const actions = renderSection([fact()]);
    openMenu("Remove entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "Was wrong" }));
    expect(actions.retract).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.retract).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "c1" }));
  });

  it("cancel leaves the fact alone", () => {
    const actions = renderSection([fact()]);
    openMenu("Remove entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "Was wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.retract).not.toHaveBeenCalled();
  });
});

describe("CompactCategorySection — edit offers It changed and Fix a mistake", () => {
  it("It changed asks for the new value and the day it changed", () => {
    const actions = renderSection([fact()]);
    openMenu("Edit entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "It changed" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New value" }), { target: { value: "Green" } });
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.changed).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "c1" }), "Green", "2026-09-01");
  });

  it("Fix a mistake corrects the value in place", () => {
    const actions = renderSection([fact({ value: "Bleu" })]);
    openMenu("Edit entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "Fix a mistake" }));
    const input = screen.getByRole("textbox", { name: "Value" });
    expect(input).toHaveValue("Bleu");
    fireEvent.change(input, { target: { value: "Blue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.fix).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "c1" }), "Blue");
  });
});

describe("CompactCategorySection — two answers", () => {
  const conflict = () => [
    fact({ claim_id: "a", value: "Berlin", has_conflict: true }),
    fact({ claim_id: "b", value: "London", has_conflict: true, created_at: "2026-02-01T00:00:00Z" }),
  ];

  it("shows a badge; Keep this one keeps that value", () => {
    const actions = renderSection(conflict());
    expect(screen.getByText("Two answers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep this one: London" }));
    expect(actions.keepOnly).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "s1" }),
      expect.objectContaining({ claim_id: "b" }),
    );
  });

  it("Both are true makes the slot hold several values", () => {
    const actions = renderSection(conflict());
    fireEvent.click(screen.getByRole("button", { name: "Both are true" }));
    expect(actions.updateSlot).toHaveBeenCalledWith(expect.objectContaining({ slotId: "s1" }), { cardinality: "many" });
  });
});

describe("CompactCategorySection — history rows can be corrected (plan 8, eleventh review: not fixed)", () => {
  const openHistory = () => fireEvent.click(screen.getByRole("button", { name: /History \(1\)/ }));

  it("a value dated in the future says when it starts and offers Fix the date", () => {
    const actions = renderSection([
      fact({ claim_id: "old", value: "Berlin", valid_to: "2062-09-01" }),
      fact({ claim_id: "new", value: "London", is_current: false, valid_from: "2062-09-01", valid_to: null }),
    ]);
    openHistory();
    expect(screen.getByText(/starts/)).toBeInTheDocument();
    openMenu("History entry options: London");
    expect(screen.queryByRole("menuitem", { name: "Still true" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Fix the date" }));
    const since = screen.getByLabelText("Since");
    expect(since).toHaveValue("2062-09-01");
    fireEvent.change(since, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.redate).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "new" }), "2026-09-01");
  });

  it("an ended value can be made current again, fixed, or removed as wrong", () => {
    const actions = renderSection([
      fact({ claim_id: "a", value: "Blue" }),
      fact({ claim_id: "b", value: "Rde", is_current: false, valid_to: "2026-03-01" }),
    ]);
    openHistory();
    openMenu("History entry options: Rde");
    fireEvent.click(screen.getByRole("menuitem", { name: "Still true" }));
    expect(actions.reopen).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "b" }));

    openMenu("History entry options: Rde");
    fireEvent.click(screen.getByRole("menuitem", { name: "Fix a mistake" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "Red" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.fix).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "b" }), "Red");

    openMenu("History entry options: Rde");
    fireEvent.click(screen.getByRole("menuitem", { name: "Was wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.retract).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "b" }));
  });

  it("Fix the date is offered on a current value that has a start date", () => {
    const actions = renderSection([fact({ valid_from: "2016-09-01" })]);
    openMenu("Edit entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "Fix the date" }));
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actions.redate).toHaveBeenCalledWith(expect.objectContaining({ claim_id: "c1" }), "2026-09-01");
  });

  it("It changed starts on the profile's day, not the browser's", () => {
    renderSection([fact()], {}, () => "2026-09-28");
    openMenu("Edit entry");
    fireEvent.click(screen.getByRole("menuitem", { name: "It changed" }));
    expect(screen.getByLabelText("Since")).toHaveValue("2026-09-28");
  });
});

describe("CompactCategorySection — a private section that still holds facts", () => {
  it("is not offered for deletion (the database would refuse it with a raw error)", () => {
    renderSection([fact()], { visibility_scope: "private" });
    openMenu("Category actions");
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete category/ }));
    expect(screen.getByText(/would be shown to assistants/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
