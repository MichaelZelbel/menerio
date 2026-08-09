import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CompactCategorySection } from "../CompactCategorySection";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProfileCategory } from "@/hooks/useProfile";
import type { ContactProfileEntry } from "@/hooks/useContactProfile";

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

const entry = (over: Partial<ContactProfileEntry> = {}): ContactProfileEntry => ({
  id: "e1",
  user_id: "user-1",
  category_id: "cat-1",
  label: "Favorite color",
  value: "Blue",
  linked_note_id: null,
  is_pinned: false,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  origin: "user_manual",
  evidence_quote: null,
  ...over,
});

function renderSection(overrides: Partial<React.ComponentProps<typeof CompactCategorySection>> = {}) {
  const handlers = {
    onSaveEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    onTogglePin: vi.fn(),
    onUpdateCategory: vi.fn(),
    onDeleteCategory: vi.fn(),
  };
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CompactCategorySection
          category={category()}
          entries={[]}
          filterQuery=""
          matches={new Map()}
          {...handlers}
          {...overrides}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return handlers;
}

describe("CompactCategorySection — empty custom category affordance (regression: custom-category dead end)", () => {
  it("shows a 'no facts yet' hint with an Add button when the rendered section has zero entries", () => {
    renderSection();
    expect(screen.getByText("No facts yet — add one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeInTheDocument();
  });

  it("clicking the hint's Add button opens the EntryForm create mode", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByPlaceholderText("e.g., Favorite book")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    // Hint retracts once the create form is open, so there's no duplicate CTA.
    expect(screen.queryByText("No facts yet — add one")).not.toBeInTheDocument();
  });

  it("does not show the empty-state hint once the category has an entry", () => {
    renderSection({ entries: [entry()] });
    expect(screen.queryByText("No facts yet — add one")).not.toBeInTheDocument();
    expect(
      screen.getByText((_, el) => /^favorite colors?:$/i.test(el?.textContent?.trim() ?? "") && el?.tagName === "SPAN"),
    ).toBeInTheDocument();
  });
});
