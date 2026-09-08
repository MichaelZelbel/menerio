import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ user: { id: "A" }, read: vi.fn(), retry: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../recovery", () => ({ readRecovery: mocks.read }));
vi.mock("../connector", () => ({ SupabaseConnector: class { retryRecovery = mocks.retry; } }));
import { RecoveryNotice } from "../RecoveryNotice";
beforeEach(() => {
  mocks.user = { id: "A" };
  mocks.read.mockReset().mockImplementation(async (owner: string) => owner === "A" ? [{ id: "batch", status: "recovery", kind: "data", code: "22P02", completed: 0, operations: [{ id: "note", opData: { title: "A private title" } }] }] : []);
  mocks.retry.mockReset().mockResolvedValue(undefined);
});
it("shows saved changes and offers retry and export", async () => {
  render(<RecoveryNotice />);
  expect(await screen.findByText(/A private title/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export saved changes" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry saved changes" }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce());
});
it("hides the previous owner's saved changes immediately on an account change", async () => {
  const view = render(<RecoveryNotice />);
  await screen.findByText(/A private title/);
  mocks.user = { id: "B" };
  view.rerender(<RecoveryNotice />);
  expect(screen.queryByText(/A private title/)).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith("B"));
});
