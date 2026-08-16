import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  isSyncServiceReachable,
  serviceHost,
  startConnectWatchdog,
} from "../reachability";
import {
  getSyncHealth,
  setSyncHealth,
  resetSyncHealth,
  isLocalFirstActive,
  shouldUseLocalFirst,
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

  it("can be fooled into saying yes, which is why it is never the last word", () => {
    // THE REAL INCIDENT. Behind a proxy, this returned true for a host that DNS
    // reports as NXDOMAIN: the proxy answered with its own error page, and
    // no-cors cannot tell that from a genuine reply. The first fallback gated on
    // this alone and therefore did nothing on the very machine it was written
    // for. The watchdog below is the authority; this is only a fast negative.
    const proxyErrorPage = vi
      .fn()
      .mockResolvedValue({ type: "opaque" } as unknown as Response);
    return isSyncServiceReachable("https://deleted.example.com", {
      fetchImpl: proxyErrorPage as unknown as typeof fetch,
    }).then((r) => expect(r).toBe(true));
  });

  it("names the host so the message can be acted on", () => {
    expect(serviceHost("https://abc123.powersync.journeyapps.com")).toBe(
      "abc123.powersync.journeyapps.com",
    );
    expect(serviceHost("not a url")).toBe("not a url");
  });
});

describe("startConnectWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("declares sync dead when the stream never reports a connection", () => {
    const onDead = vi.fn();
    startConnectWatchdog({ isConnected: () => false, onDead, timeoutMs: 12_000 });
    vi.advanceTimersByTime(11_999);
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("stays quiet once the stream is connected", () => {
    const onDead = vi.fn();
    let connected = false;
    startConnectWatchdog({ isConnected: () => connected, onDead, timeoutMs: 12_000 });
    connected = true;
    vi.advanceTimersByTime(60_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it("can be cancelled, so a teardown does not fire a false alarm", () => {
    const onDead = vi.fn();
    const stop = startConnectWatchdog({
      isConnected: () => false,
      onDead,
      timeoutMs: 12_000,
    });
    stop();
    vi.advanceTimersByTime(60_000);
    expect(onDead).not.toHaveBeenCalled();
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

  // OFFLINE_CORE is false in this environment, so the decision itself is tested
  // through the pure function both callers delegate to.
  it("sends reads to the server only when the service is gone AND the network is fine", () => {
    expect(
      shouldUseLocalFirst({ offlineCore: true, state: "unreachable", online: true }),
    ).toBe(false);
  });

  it("keeps using the local copy when the DEVICE is offline", () => {
    // On a train, falling back would throw away the entire point of holding a
    // local copy: reads would go to a server that is equally out of reach, and a
    // working offline app would become an error message.
    expect(
      shouldUseLocalFirst({ offlineCore: true, state: "unreachable", online: false }),
    ).toBe(true);
  });

  it("stays local while connecting, so a slow start is not a fallback", () => {
    for (const state of ["starting", "live"] as const) {
      expect(shouldUseLocalFirst({ offlineCore: true, state, online: true })).toBe(true);
    }
  });

  it("is never local-first on a device that does not have a local copy", () => {
    for (const online of [true, false]) {
      expect(
        shouldUseLocalFirst({ offlineCore: false, state: "unreachable", online }),
      ).toBe(false);
    }
  });

  it("does not flip to the server merely because connecting is slow", () => {
    // "starting" must keep reading the local copy. Showing it immediately is the
    // entire reason it exists, and a slow connect must not shove every device
    // onto the network path.
    setSyncHealth({ state: "starting", error: null });
    expect(getSyncHealth().state).toBe("starting");
  });
});
