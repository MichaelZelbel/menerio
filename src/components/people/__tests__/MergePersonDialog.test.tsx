import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MergePersonDialog } from "../MergePersonDialog";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/toast", () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

const invokeMock = vi.fn(async () => ({ data: { success: true }, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

function renderDialog(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MergePersonDialog
        open
        onOpenChange={vi.fn()}
        sourcePerson={{ id: "p-source", name: "Duplicate Dana", aliases: [] }}
        allPeople={[
          { id: "p-source", name: "Duplicate Dana", aliases: [] },
          { id: "p-target", name: "Real Dana", aliases: [] },
        ]}
        onMergeComplete={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("MergePersonDialog — cache invalidation (regression: ghost membership counts after merge)", () => {
  it("invalidates contact_group_memberships and person_groups (alongside contacts) once the merge succeeds", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    renderDialog(qc);

    // Pick "Me (my own profile)" as the merge target.
    fireEvent.click(screen.getByText("Me (my own profile)").closest("button")!);
    // Confirmation dialog opens; confirm the merge.
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    // Wait for the mutation's onSuccess to have run.
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
        JSON.stringify((call[0] as { queryKey?: unknown })?.queryKey),
      );
      expect(invalidatedKeys).toContain(JSON.stringify(["contacts"]));
      expect(invalidatedKeys).toContain(JSON.stringify(["contact_group_memberships"]));
      expect(invalidatedKeys).toContain(JSON.stringify(["person_groups"]));
    });
  });
});
