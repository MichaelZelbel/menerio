import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { StaffAccessCard, describeStaffAction } from "@/components/settings/StaffAccessCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StaffAccessCard /></QueryClientProvider>);
}

beforeEach(() => rpc.mockReset());

describe("StaffAccessCard", () => {
  it("says so plainly when nobody has acted on the account", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderCard();
    expect(await screen.findByText("Nobody at Menerio has taken any action on your account.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("my_staff_access_log");
  });

  it("lists each entry in plain words", async () => {
    rpc.mockResolvedValue({ data: [
      { action: "moderation_review", actor_kind: "system", note_id: "n1", created_at: "2026-10-02T10:00:00Z" },
      { action: "user_roles_update", actor_kind: "admin", note_id: null, created_at: "2026-10-01T09:00:00Z" },
    ], error: null });
    renderCard();
    expect(await screen.findByText("Our automatic check read a note you shared publicly")).toBeInTheDocument();
    expect(screen.getByText("An administrator changed your plan")).toBeInTheDocument();
  });

  it("shows an error line rather than an empty list when the log cannot load", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    renderCard();
    expect(await screen.findByText("The staff access list could not be loaded. Please try again later.")).toBeInTheDocument();
  });
});

describe("describeStaffAction", () => {
  it("falls back to a general sentence for an action it does not know", () => {
    expect(describeStaffAction("something_new")).toBe("An administrator took an action on your account");
  });
});
