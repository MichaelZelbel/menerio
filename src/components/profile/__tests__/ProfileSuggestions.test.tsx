import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: {
      invoke: async () => ({
        data: {
          suggestions: [{ category_slug: "food", label: "Favorite food", value: "Hotpot", confidence: "high", reason: "Mentioned twice" }],
        },
        error: null,
      }),
    },
  },
}));

import { ProfileSuggestions } from "../ProfileSuggestions";

beforeEach(() => localStorage.clear());

async function showSuggestion(onAccept: () => Promise<unknown>) {
  render(<ProfileSuggestions categories={[]} factCount={10} noteCount={0} onAccept={onAccept} />);
  fireEvent.click(screen.getByRole("button", { name: /Suggest entries from my notes/ }));
  await waitFor(() => expect(screen.getByText("Hotpot")).toBeInTheDocument());
}

describe("ProfileSuggestions — accepting", () => {
  it("keeps the suggestion when the fact was not saved, so it can be accepted again", async () => {
    const onAccept = vi.fn(async () => {
      throw new Error("updating, try again in a few minutes");
    });
    await showSuggestion(onAccept);
    fireEvent.click(screen.getByTitle("Add to profile"));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Hotpot")).toBeInTheDocument();
    expect(localStorage.getItem("menerio-dismissed-profile-suggestions")).toBeNull();
  });

  it("removes the suggestion once the fact is saved", async () => {
    const onAccept = vi.fn(async () => undefined);
    await showSuggestion(onAccept);
    fireEvent.click(screen.getByTitle("Add to profile"));
    await waitFor(() => expect(screen.queryByText("Hotpot")).not.toBeInTheDocument());
    expect(onAccept).toHaveBeenCalledWith({ category_slug: "food", label: "Favorite food", value: "Hotpot" });
  });
});
