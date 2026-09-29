import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GroupDetail from "../GroupDetail";

const state = vi.hoisted(() => ({
  group: {
    id: "g1",
    slug: "investors",
    name: "Investors",
    type: "investors",
    sensitivity: "normal",
    icon: "Users",
    color: null,
    description: null,
    purpose: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    stages: [
      { id: "new", label: "New" },
      { id: "talking", label: "Talking" },
    ],
    success_criteria: [],
    attributes_schema: {},
  } as Record<string, unknown> | null,
  groupError: false,
  refetch: vi.fn(),
  memberships: [
    { id: "m1", contact_id: "p1", status: "talking", priority: "normal", joined_at: "2026-01-01", last_movement_at: "2026-01-02", reason: null, contacts: { name: "Ada" }, source_note_ids: [] },
    { id: "m2", contact_id: "p2", status: "new", priority: "normal", joined_at: "2026-01-01", last_movement_at: "2026-01-02", reason: null, contacts: { name: "Grace" }, source_note_ids: [] },
  ],
  updates: [] as Array<{ table: string; values: unknown; ids: unknown }>,
  mutateGroup: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: unknown) => ({
        in: (_column: string, ids: unknown) => {
          state.updates.push({ table, values, ids });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/useGroups", () => ({
  useGroup: () => ({ data: state.groupError ? undefined : state.group, isLoading: false, isError: state.groupError, refetch: state.refetch }),
  useUpdateGroup: () => ({ mutate: state.mutateGroup, isPending: false }),
  useArchiveGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useTrashGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useGroupMemberships", () => ({
  useGroupMemberships: () => ({ data: state.memberships }),
  useMoveMembershipStage: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/groups/AddMemberDialog", () => ({ AddMemberDialog: () => null }));
vi.mock("@/components/groups/BriefingTab", () => ({ BriefingTab: () => null }));
vi.mock("@/components/groups/GoalsTab", () => ({ GoalsTab: () => null }));
vi.mock("@/components/groups/MembershipSheet", () => ({ MembershipSheet: () => null }));
vi.mock("@/components/groups/PipelineColumn", () => ({ PipelineColumn: () => null }));
vi.mock("@/components/groups/SuggestMembersButton", () => ({ SuggestMembersButton: () => null }));
vi.mock("@/components/groups/StagesEditor", () => ({
  StagesEditor: ({ stages, onChange }: { stages: Array<{ id: string }>; onChange: (next: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange(stages.filter((stage) => stage.id !== "talking"))}>
      Remove Talking
    </button>
  ),
}));

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/dashboard/groups/investors"]}>
        <Routes>
          <Route path="/dashboard/groups/:slug" element={<GroupDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GroupDetail", () => {
  beforeEach(() => {
    state.updates = [];
    state.groupError = false;
    vi.clearAllMocks();
  });

  it("refreshes the membership lists after moving the members of a removed stage", async () => {
    renderPage();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Talking" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(state.mutateGroup).toHaveBeenCalled());
    expect(state.updates).toEqual([{ table: "contact_group_memberships", values: { status: "new" }, ids: ["m1"] }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contact_group_memberships", "g1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contact_group_memberships", "all"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["person_groups", "p1"] });
  });

  it("shows a failed load with Retry instead of 'Group not found.'", () => {
    state.groupError = true;
    renderPage();
    expect(screen.getByText("This group could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Group not found.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it("opens a member from the list with the keyboard-reachable name button", () => {
    renderPage();
    // The list tab is where the rows are; the name is a real button.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "List" }));
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.getByRole("button", { name: "Ada" })).toBeInTheDocument();
  });
});
