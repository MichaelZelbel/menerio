import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PeopleTree, type PeopleTreeProps } from "../PeopleTree";
import type { Person } from "@/hooks/usePeople";
import type { ContactGroupRow } from "@/hooks/useGroups";

// PeopleBulkBar (rendered when a selection exists) pulls in auth-dependent
// mutation hooks; the tree's selection behavior is what's under test here.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

const person = (id: string, name: string, over: Partial<Person> = {}): Person => ({
  id,
  user_id: "u1",
  name,
  notes: null,
  tags: [],
  aliases: [],
  app_mappings: {},
  metadata: {},
  merged_into: null,
  is_favorite: false,
  last_viewed_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const group = (id: string, name: string): ContactGroupRow =>
  ({
    id,
    name,
    slug: name.toLowerCase(),
    user_id: "u1",
    type: "other",
    stages: [],
    success_criteria: [],
    attributes_schema: {},
    description: null,
    purpose: null,
    sensitivity: "normal",
    template: null,
    icon: null,
    color: null,
    archived_at: null,
    is_trashed: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    parent_group_id: null,
  }) as unknown as ContactGroupRow;

const marco = person("p-marco", "Marco Test");
const anna = person("p-anna", "Anna");
const team = group("g-team", "Team");

function renderTree(overrides: Partial<PeopleTreeProps> = {}) {
  const handlers = {
    onSelectPerson: vi.fn(),
    onToggleFavorite: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onArchiveGroup: vi.fn(),
    onReparentGroup: vi.fn(),
    onAddToGroup: vi.fn(),
    onRemoveFromGroup: vi.fn(),
    onCreatePerson: vi.fn(),
    onMergePerson: vi.fn(),
    onDeletePerson: vi.fn(),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PeopleTree
          people={[marco, anna]}
          groups={[team]}
          memberships={[{ id: "m1", group_id: "g-team", contact_id: "p-anna", status: null }]}
          selectedPersonId={null}
          searchQuery=""
          {...handlers}
          {...overrides}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PeopleTree — bulk-select checkbox clicks (regression: checkbox click navigated away)", () => {
  it("checkbox click in the tree selects the person, prevents the row anchor's navigation, and shows the bulk bar", () => {
    const handlers = renderTree();

    // Marco has no membership → renders directly under "All People" (expanded by default),
    // alongside groups, just like loose notes appear under the notes root.
    const checkbox = screen.getByRole("checkbox", { name: "Select Marco Test" });

    // The row is an <a href>; if nothing preventDefaults the click, the browser
    // performs a native full-page navigation and all selection state is lost.
    // fireEvent returns false when defaultPrevented — that's the contract.
    const defaultNotPrevented = fireEvent.click(checkbox);
    expect(defaultNotPrevented).toBe(false);

    // Selection registered on ALL rendered instances of the person.
    screen
      .getAllByRole("checkbox", { name: "Select Marco Test" })
      .forEach((box) => expect(box).toHaveAttribute("aria-checked", "true"));

    // No row navigation happened.
    expect(handlers.onSelectPerson).not.toHaveBeenCalled();

    // Bulk bar appeared for the selection.
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("second checkbox click deselects and hides the bulk bar", () => {
    renderTree();
    const checkbox = screen.getByRole("checkbox", { name: "Select Marco Test" });

    fireEvent.click(checkbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    screen
      .getAllByRole("checkbox", { name: "Select Marco Test" })
      .forEach((box) => expect(box).toHaveAttribute("aria-checked", "false"));
  });

  it("checkbox click works the same way in search-mode flat rows", () => {
    const handlers = renderTree({ searchQuery: "marco" });

    const checkbox = screen.getByRole("checkbox", { name: "Select Marco Test" });
    const defaultNotPrevented = fireEvent.click(checkbox);
    expect(defaultNotPrevented).toBe(false);

    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(handlers.onSelectPerson).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("selects a person under a group row (member rows share the same code path)", () => {
    const handlers = renderTree();

    // Expand the Team group under "All People" (expanded by default).
    fireEvent.click(screen.getByRole("button", { name: /^Team/ }));
    const checkbox = screen.getByRole("checkbox", { name: "Select Anna" });

    const defaultNotPrevented = fireEvent.click(checkbox);
    expect(defaultNotPrevented).toBe(false);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(handlers.onSelectPerson).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("plain row click still navigates to the person (and never full-page navigates)", () => {
    const handlers = renderTree();

    const row = screen.getByRole("link", { name: /Marco Test/ });
    const defaultNotPrevented = fireEvent.click(row);

    expect(defaultNotPrevented).toBe(false); // anchor default must be prevented
    expect(handlers.onSelectPerson).toHaveBeenCalledWith("p-marco");
  });
});

describe("PeopleTree — favorites and infinite scroll", () => {
  it("lists a favorite that no loaded page contains yet", () => {
    const yuki = person("p-yuki", "Yuki Zed", { is_favorite: true });
    renderTree({ pinnedPeople: [yuki] });
    fireEvent.click(screen.getByText("Favorites"));
    expect(screen.getByText("Yuki Zed")).toBeInTheDocument();
    // Not repeated under All People, which only shows loaded pages.
    expect(screen.getAllByText("Yuki Zed")).toHaveLength(1);
  });

  it("asks for the next page when the end of the list scrolls into view", () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    try {
      const onLoadMore = vi.fn();
      renderTree({ hasMore: true, onLoadMore, totalPeople: 120 });
      expect(screen.getByText("120")).toBeInTheDocument();
      observers.at(-1)!([{ isIntersecting: true }]);
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });
});

describe("PeopleTree — groups beyond the loaded pages", () => {
  it("shows a group member whose name sorts past the loaded pages, from the membership row", () => {
    renderTree({
      memberships: [
        { id: "m1", group_id: "g-team", contact_id: "p-anna", status: null },
        {
          id: "m2",
          group_id: "g-team",
          contact_id: "p-zoe",
          status: null,
          contacts: { id: "p-zoe", name: "Zoe Late", aliases: [], is_favorite: false, last_viewed_at: null, merged_into: null },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Team/ }));
    expect(screen.getByText("Zoe Late")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Team/ })).toHaveTextContent("2");
  });

  it("does not say 'No people found' while a search is still running", () => {
    renderTree({ people: [], searchQuery: "zo", serverSearch: true, loading: true });
    expect(screen.queryByText("No people found")).not.toBeInTheDocument();
  });
});
