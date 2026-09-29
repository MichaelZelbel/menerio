import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitHubSyncSettings } from "../GitHubSyncSettings";

const deletes: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        eq: async () => {
          deletes.push(table);
          return { error: null };
        },
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const bulkMutate = vi.fn();
vi.mock("@/hooks/useGitHubSync", () => ({
  useGitHubConnection: () => ({
    data: {
      id: "c1", user_id: "user-1", github_username: "me", repo_owner: "me", repo_name: "vault",
      branch: "main", vault_path: "/", sync_enabled: true, sync_direction: "export", sync_people: true,
      last_sync_at: null, created_at: "", updated_at: "",
    },
    isLoading: false,
    refetch: vi.fn(async () => ({})),
  }),
  useGitHubBulkSync: () => ({ mutate: bulkMutate, isPending: false, data: undefined }),
}));
vi.mock("@/hooks/usePeopleSync", () => ({
  useGitHubPeopleBulkSync: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../SyncDashboard", () => ({ SyncDashboard: () => null, FolderMappingSettings: () => null }));
vi.mock("../SyncConflictsPanel", () => ({ SyncConflictsPanel: () => null }));
vi.mock("../ImportVaultDialog", () => ({ ImportVaultDialog: () => null }));

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  showToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn() },
}));

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GitHubSyncSettings />
    </QueryClientProvider>,
  );

beforeEach(() => {
  deletes.length = 0;
  bulkMutate.mockReset();
  toastError.mockReset();
});

describe("GitHubSyncSettings", () => {
  it("asks before Disconnect deletes the token and the note-to-file mapping", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText("Disconnect GitHub?")).toBeInTheDocument();
    expect(deletes).toEqual([]);

    const buttons = screen.getAllByRole("button", { name: "Disconnect" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(deletes).toEqual(["github_connections", "github_sync_log"]));
  });

  it("names the export failure from the function's answer, not the invoke error's message", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /Export All/ }));
    const { onError } = bulkMutate.mock.calls[0][1] as { onError: (e: unknown) => Promise<void> };
    await onError(
      Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: new Response(JSON.stringify({ error: "Insufficient AI credits" }), { status: 402 }),
      }),
    );
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("used up your AI credits"));
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining("non-2xx"));
  });
});
