import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {};
let currentRole = "free";
let lastFilters: [string, unknown][] = [];

function query(table: string) {
  const filters: [string, unknown][] = [];
  const result = () => {
    lastFilters = filters;
    const rows = (db[table] || []).filter((row) => filters.every(([c, v]) => row[c] === v));
    return { data: rows, error: null };
  };
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    range: () => builder,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => query(table) } }));
const user = { id: "admin-1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, role: currentRole }) }));

import ActivityPage from "@/pages/ActivityPage";

beforeEach(() => {
  currentRole = "free";
  lastFilters = [];
  db.activity_events = [
    { id: "e1", actor_id: "admin-1", action: "create", item_type: "note", created_at: "2026-09-01T00:00:00Z" },
    { id: "e2", actor_id: "other-user", action: "create", item_type: "note", created_at: "2026-09-01T00:00:00Z" },
  ];
});

describe("ActivityPage", () => {
  it("scopes an admin's own log to their own events, the same as any other user", async () => {
    currentRole = "admin";
    render(<ActivityPage />);
    expect(await screen.findByText("Created a note")).toBeInTheDocument();
    // Only the admin's own event, never the other user's.
    expect(lastFilters).toContainEqual(["actor_id", "admin-1"]);
    expect(screen.queryByText(/All user activity/i)).not.toBeInTheDocument();
    expect(screen.getByText("Your recent actions and events.")).toBeInTheDocument();
  });

  it("shows the same caption for a non-admin", async () => {
    currentRole = "free";
    render(<ActivityPage />);
    await screen.findByText("Created a note");
    expect(screen.getByText("Your recent actions and events.")).toBeInTheDocument();
  });
});
