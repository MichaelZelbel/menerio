import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { isSyncServiceReachable, serviceHost } from "../reachability";
import {
  getSyncHealth,
  setSyncHealth,
  resetSyncHealth,
  isLocalFirstActive,
  subscribe,
} from "../sync-health";

/**
 * THE FAILURE THESE LOCK OUT.
 *
 * Menerio's PowerSync instance was deleted. Its hostname returns NXDOMAIN. Every
 * local-first device kept rendering a frozen local database and said nothing:
 * the connect error was a console.warn that the production build strips, it was
 * attempted once per page load with no retry, and the note list read local
 * SQLite unconditionally. The app looked completely healthy while showing data
 * that was weeks out of date.
 */

describe("isSyncServiceReachable", () => {
  it("says no when the host does not resolve", async () => {
    // What a deleted instance actually does: fetch rejects outright.
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await isSyncServiceReachable("https://gone.example.com", { fetchImpl })).toBe(
      false,
    );
  });

  it("says yes for an opaque reply, because no-cors is all we can see", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: "opaque" } as unknown as Response);
    expect(await isSyncServiceReachable("https://up.example.com", { fetchImpl })).toBe(true);
  });

  it("says yes for a 404, because the host answering is the whole question", async () => {
    // A reachable service that has no route at / is still reachable. Treating
    // that as an outage would push every healthy device onto the fallback.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await isSyncServiceReachable("https://up.example.com", { fetchImpl })).toBe(true);
  });

  it("says no when the service never answers, rather than hanging forever", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    const reachable = await isSyncServiceReachable("https://slow.example.com", {
      fetchImpl,
      timeoutMs: 10,
    });
    expect(reachable).toBe(false);
  });

  it("treats an empty url as unreachable instead of fetching nothing", async () => {
    const fetchImpl = vi.fn();
    expect(await isSyncServiceReachable("", { fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names the host so the message can be acted on", () => {
    expect(serviceHost("https://abc123.powersync.journeyapps.com")).toBe(
      "abc123.powersync.journeyapps.com",
    );
    expect(serviceHost("not a url")).toBe("not a url");
  });
});

describe("sync health store", () => {
  beforeEach(() => resetSyncHealth());
  afterEach(() => resetSyncHealth());

  it("keeps the same snapshot identity when nothing changed", () => {
    // useSyncExternalStore compares snapshots by reference and re-renders on
    // every new one, so handing back a fresh object each call is an infinite
    // render loop rather than a cosmetic issue.
    const before = getSyncHealth();
    setSyncHealth({ state: before.state, error: before.error });
    expect(getSyncHealth()).toBe(before);
  });

  it("hands out a new snapshot when something did change", () => {
    const before = getSyncHealth();
    setSyncHealth({ state: "unreachable", error: "gone" });
    expect(getSyncHealth()).not.toBe(before);
    expect(getSyncHealth().state).toBe("unreachable");
  });

  it("tells subscribers only about real changes", () => {
    const seen = vi.fn();
    setSyncHealth({ state: "live", error: null });
    const stop = subscribe(seen);

    setSyncHealth({ state: "live", error: null }); // same again
    expect(seen).not.toHaveBeenCalled();

    setSyncHealth({ state: "unreachable", error: "gone" });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it("carries the count of edits that exist only on this device", () => {
    // The one number that means possible data loss, so it must survive into the
    // state the UI reads rather than being logged and forgotten.
    setSyncHealth({ state: "unreachable", error: "gone", pendingUploads: 4 });
    expect(getSyncHealth().pendingUploads).toBe(4);
  });
});

describe("isLocalFirstActive", () => {
  beforeEach(() => resetSyncHealth());
  afterEach(() => resetSyncHealth());

  // OFFLINE_CORE is false under test (no Tauri, no localStorage flag), which is
  // the plain web session: there is no local-first path to fall back FROM.
  it("is false on a device that was never local-first", () => {
    expect(isLocalFirstActive()).toBe(false);
  });

  it("stays false once the service is known to be unreachable", () => {
    setSyncHealth({ state: "unreachable", error: "gone" });
    expect(isLocalFirstActive()).toBe(false);
  });

  it("does not flip to the server merely because connecting is slow", () => {
    // "starting" must keep reading the local copy. Showing it immediately is the
    // entire reason it exists, and a slow connect must not shove every device
    // onto the network path.
    setSyncHealth({ state: "starting", error: null });
    expect(getSyncHealth().state).toBe("starting");
  });
});
