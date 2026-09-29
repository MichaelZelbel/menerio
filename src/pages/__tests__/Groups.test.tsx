import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Groups from "../Groups";

const state = vi.hoisted(() => ({
  groups: { data: undefined as unknown[] | undefined, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() },
}));

vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/useGroups", () => ({
  useGroups: () => state.groups,
  useCreateGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useGroupMemberships", () => ({ useAllMemberships: () => ({ data: [] }) }));
vi.mock("@/components/groups/InitialMigrationCard", () => ({
  InitialMigrationCard: () => <div>Convert tags to groups</div>,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Groups />
    </MemoryRouter>,
  );

const group = (id: string, name: string, archived = false) => ({
  id,
  name,
  slug: id,
  description: null,
  icon: "Users",
  archived_at: archived ? "2026-01-01" : null,
  success_criteria: [],
});

describe("Groups", () => {
  beforeEach(() => {
    state.groups = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() };
  });

  it("shows a failed load with Retry, and never offers to convert tags then", () => {
    state.groups = { data: undefined, isLoading: false, isError: true, isSuccess: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Your groups could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No groups yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Convert tags to groups")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.groups.refetch).toHaveBeenCalled();
  });

  it("offers the tag conversion only when the user truly has no groups", () => {
    renderPage();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(screen.getByText("Convert tags to groups")).toBeInTheDocument();
  });

  it("says a search found nothing instead of 'No groups yet'", () => {
    state.groups.data = [group("g1", "Investors")];
    renderPage();
    fireEvent.change(screen.getByLabelText("Search groups"), { target: { value: "zzz" } });
    expect(screen.getByText("No groups match your search.")).toBeInTheDocument();
    expect(screen.queryByText("No groups yet.")).not.toBeInTheDocument();
  });

  it("links each group card so it opens from the keyboard", () => {
    state.groups.data = [group("investors", "Investors")];
    renderPage();
    expect(screen.getByRole("link", { name: /Investors/ })).toHaveAttribute("href", "/dashboard/groups/investors");
  });
});
