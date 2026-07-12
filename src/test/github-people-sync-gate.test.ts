import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GitHubConnection } from "@/hooks/useGitHubSync";

const invokeMock = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import { schedulePeopleExport, shouldSyncPeople } from "@/lib/github-people-sync";

const connection = {
  sync_enabled: true,
  repo_owner: "michael",
  repo_name: "brain",
  sync_direction: "bidirectional",
  sync_people: true,
} as GitHubConnection;

describe("shouldSyncPeople gate", () => {
  it("requires a connection with repo, sync enabled, people sync on, and an exporting direction", () => {
    expect(shouldSyncPeople(connection)).toBe(true);
    expect(shouldSyncPeople({ ...connection, sync_direction: "export" })).toBe(true);
    expect(shouldSyncPeople(null)).toBe(false);
    expect(shouldSyncPeople(undefined)).toBe(false);
    expect(shouldSyncPeople({ ...connection, sync_enabled: false })).toBe(false);
    expect(shouldSyncPeople({ ...connection, repo_owner: null })).toBe(false);
    expect(shouldSyncPeople({ ...connection, repo_name: null })).toBe(false);
    expect(shouldSyncPeople({ ...connection, sync_people: false })).toBe(false);
    expect(shouldSyncPeople({ ...connection, sync_direction: "import" })).toBe(false);
  });
});

describe("schedulePeopleExport debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("collapses rapid calls into one sweep and merges force hints", () => {
    schedulePeopleExport(connection, { people: ["p1"] });
    schedulePeopleExport(connection);
    schedulePeopleExport(connection, { groups: ["g1"], people: ["p2"] });
    expect(invokeMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fn, opts] = invokeMock.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("github-people-sync");
    expect(opts.body.sweep).toBe(true);
    expect(opts.body.force_people).toEqual(["p1", "p2"]);
    expect(opts.body.force_groups).toEqual(["g1"]);
  });

  it("does nothing when the gate is closed", () => {
    schedulePeopleExport({ ...connection, sync_people: false });
    vi.advanceTimersByTime(5000);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
