import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IntegrationsOverview } from "../IntegrationsOverview";

type Result = { data?: unknown; count?: number | null; error?: unknown };

// Every builder call per table, so the test can see which columns were filtered.
const calls: Record<string, unknown[][]> = {};
let results: Record<string, Result> = {};
let invokeResult: { data: unknown; error: unknown } = { data: { keys: [] }, error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls[table] = [];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not", "in", "order"]) {
        builder[method] = (...args: unknown[]) => {
          calls[table].push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], count: 0, error: null }).then(resolve, reject);
      return builder;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
    functions: { invoke: async () => invokeResult },
  },
}));

// A new user object on every render, as a token refresh produces: the load
// must key on the id, or this test never settles.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  results = {};
  invokeResult = { data: { keys: [] }, error: null };
});

describe("IntegrationsOverview", () => {
  it("reads each integration from columns its table really has", async () => {
    results = {
      connected_apps: {
        data: [
          { app_name: "slack", connection_status: "pending" },
          { app_name: "querino", connection_status: "active" },
        ],
        error: null,
      },
      telegram_connections: { count: 1, error: null },
      discord_connections: { count: 1, error: null },
      github_connections: { count: 0, error: null },
      gdrive_connections: { count: 1, error: null },
      mcp_api_tokens: { count: 0, error: null },
    };
    invokeResult = {
      data: { keys: [{ is_active: true, scopes: ["notes"], name: "Web clipper" }] },
      error: null,
    };

    render(<IntegrationsOverview onOpenTab={() => {}} />);

    expect(await screen.findByText("Connected: 7")).toBeInTheDocument();
    expect(screen.getByText("Available: 2")).toBeInTheDocument();
    expect(within(row("Slack")).getByText("Connected")).toBeInTheDocument();
    expect(within(row("Connected Apps")).getByText("Connected")).toBeInTheDocument();
    expect(within(row("Telegram")).getByText("Connected")).toBeInTheDocument();
    expect(within(row("GitHub Sync")).getByText("Not connected")).toBeInTheDocument();
    expect(within(row("MCP Server")).getByText("Not connected")).toBeInTheDocument();

    expect(calls.connected_apps).toContainEqual(["select", "app_name, connection_status"]);
    expect(calls.connected_apps).toContainEqual(["eq", "is_active", true]);
    expect(calls.telegram_connections).toContainEqual(["eq", "is_paired", true]);
    expect(calls.discord_connections).toContainEqual(["eq", "is_active", true]);
    expect(calls.mcp_api_tokens).toContainEqual(["is", "revoked_at", null]);
    const everyArg = JSON.stringify(calls);
    for (const missing of ["app_type", "telegram_user_id", "discord_user_id"]) {
      expect(everyArg).not.toContain(missing);
    }
    expect(calls.mcp_api_tokens).not.toContainEqual(["eq", "is_active", true]);
  });

  it("says it could not check, instead of 'Not connected', when a check fails", async () => {
    results = {
      telegram_connections: { count: null, error: { message: "permission denied" } },
    };
    invokeResult = { data: null, error: new Error("Edge Function returned a non-2xx status code") };

    render(<IntegrationsOverview onOpenTab={() => {}} />);

    expect(await screen.findByText("Connected: 0")).toBeInTheDocument();
    expect(within(row("Telegram")).getByText("Could not check")).toBeInTheDocument();
    expect(within(row("API Keys")).getByText("Could not check")).toBeInTheDocument();
    expect(within(row("Web Clipper")).getByText("Could not check")).toBeInTheDocument();
    expect(within(row("Discord")).getByText("Not connected")).toBeInTheDocument();
    // Unknown is neither connected nor available.
    expect(screen.getByText("Available: 6")).toBeInTheDocument();
  });
});
