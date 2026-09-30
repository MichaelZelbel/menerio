import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: null }) }));

const fetchAccountCounts = vi.fn();
const fetchUserDirectory = vi.fn();
const fetchUserNames = vi.fn();
vi.mock("@/lib/adminDirectory", () => ({
  fetchAccountCounts: (...a: unknown[]) => fetchAccountCounts(...a),
  fetchUserDirectory: (...a: unknown[]) => fetchUserDirectory(...a),
  fetchUserNames: (...a: unknown[]) => fetchUserNames(...a),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  },
}));

import Admin from "@/pages/Admin";

beforeEach(() => {
  fetchAccountCounts.mockReset();
  fetchUserDirectory.mockReset();
  fetchUserNames.mockReset();
});

function goToUsersTab() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Users/i }));
  fireEvent.click(screen.getByRole("tab", { name: /Users/i }));
}

describe("Admin Overview tab", () => {
  it("shows a plain error line and stops loading when the account counts fail to load", async () => {
    fetchAccountCounts.mockRejectedValue(new Error("network down"));
    render(<Admin />);
    expect(await screen.findByText("The account statistics could not be loaded.")).toBeInTheDocument();
    // Never stuck showing the loading skeletons.
    expect(screen.queryByText("Total Users")).not.toBeInTheDocument();
  });

  it("still renders the real numbers when the counts load fine", async () => {
    fetchAccountCounts.mockResolvedValue({ totalUsers: 3, newUsers7d: 1, paidUsers: 2 });
    render(<Admin />);
    expect(await screen.findByText("Total Users")).toBeInTheDocument();
    expect(screen.queryByText("The account statistics could not be loaded.")).not.toBeInTheDocument();
  });
});

describe("Admin Users tab", () => {
  it("shows a distinct message, not 'No users found.', when the directory call fails", async () => {
    fetchAccountCounts.mockResolvedValue({ totalUsers: 0, newUsers7d: 0, paidUsers: 0 });
    fetchUserDirectory.mockRejectedValue(new Error("network down"));
    render(<Admin />);
    goToUsersTab();
    expect(await screen.findByText("The user list could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No users found.")).not.toBeInTheDocument();
  });

  it("still says 'No users found.' when the call succeeds with an empty directory", async () => {
    fetchAccountCounts.mockResolvedValue({ totalUsers: 0, newUsers7d: 0, paidUsers: 0 });
    fetchUserDirectory.mockResolvedValue({ rows: [], total: 0 });
    render(<Admin />);
    goToUsersTab();
    expect(await screen.findByText("No users found.")).toBeInTheDocument();
  });
});
