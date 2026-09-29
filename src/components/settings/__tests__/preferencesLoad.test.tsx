import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationPreferences } from "../NotificationPreferences";
import { AISuggestionPreferences } from "../AISuggestionPreferences";

type Result = { data: unknown; error: unknown };

let loadResult: Result = { data: null, error: null };
const upserts: Array<[string, unknown]> = [];
const loadCalls: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          loadCalls.push(`${table}.maybeSingle`);
          return loadResult;
        },
        single: async () => {
          loadCalls.push(`${table}.single`);
          return loadResult;
        },
        upsert: async (payload: unknown) => {
          upserts.push([table, payload]);
          return { error: null };
        },
      };
      return query;
    },
  },
}));

// A new user object on every render, as a token refresh produces.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "a@b.c" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  loadResult = { data: null, error: null };
  upserts.length = 0;
  loadCalls.length = 0;
});

const savedNotificationRow = {
  daily_digest_enabled: true,
  digest_time: "evening",
  notify_stale_actions: false,
  notify_contact_followup: true,
  notify_patterns: true,
  notify_weekly_review: false,
  digest_email: null,
};

describe("NotificationPreferences", () => {
  it("shows an error with Try again after a failed load, and no Save that could overwrite the real settings", async () => {
    loadResult = { data: null, error: { message: "JWT expired" } };
    render(<NotificationPreferences />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your notification settings");
    expect(screen.queryByRole("button", { name: /Save Preferences/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/JWT/)).not.toBeInTheDocument();

    loadResult = { data: savedNotificationRow, error: null };
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByRole("button", { name: /Save Preferences/ })).toBeEnabled();
    // The switches carry their labels, and show the saved values, not the defaults.
    expect(screen.getByRole("switch", { name: "Enable daily digest" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Stale action items" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Weekly review reminder" })).not.toBeChecked();
    expect(upserts).toHaveLength(0);
  });

  it("treats no saved row as a new account on the defaults, not as an error", async () => {
    render(<NotificationPreferences />);
    expect(await screen.findByRole("button", { name: /Save Preferences/ })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable daily digest" })).not.toBeChecked();
    expect(loadCalls).toEqual(["notification_preferences.maybeSingle"]);
  });
});

describe("AISuggestionPreferences", () => {
  it("shows an error with Try again after a failed load and offers no Save", async () => {
    loadResult = { data: null, error: { message: "permission denied" } };
    render(<AISuggestionPreferences />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your AI suggestion settings");
    expect(screen.queryByRole("button", { name: /Save Settings/ })).not.toBeInTheDocument();

    loadResult = { data: { suggestion_mode: "ask", auto_add_sensitive: true }, error: null };
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByRole("button", { name: /Save Settings/ })).toBeEnabled();
    expect(screen.getByRole("switch", { name: /Auto-add sensitive insights/ })).toBeChecked();
    expect(upserts).toHaveLength(0);
  });
});
