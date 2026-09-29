import { describe, expect, it, vi } from "vitest";
import { createGhostShellHealer, GHOST_SHELL_KEY, type GhostShellDeps } from "../ghost-shell";

class FakeWorker extends EventTarget {
  constructor(public state: ServiceWorkerState) {
    super();
  }
  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const OLD = "index-Old111.js";
const NEW = "index-New222.js";
const manifestWith = (chunk: string) => `precacheAndRoute([{url:"assets/${chunk}",revision:null}])`;

function setup(over: Partial<GhostShellDeps> & { update?: () => Promise<unknown> } = {}) {
  const reg = {
    active: new FakeWorker("activated") as unknown as ServiceWorker,
    installing: null as ServiceWorker | null,
    waiting: null as ServiceWorker | null,
    update: over.update ?? (async () => {}),
  };
  const deps: GhostShellDeps = {
    ownChunk: OLD,
    getRegistration: async () => reg,
    fetchManifest: async () => manifestWith(NEW),
    dropWorkersAndCaches: vi.fn(async () => {}),
    reload: vi.fn(),
    storage: memoryStorage(),
    settleMs: 50,
    ...over,
  };
  return { reg, deps, heal: createGhostShellHealer(deps) };
}

describe("ghost-shell self-heal", () => {
  it("does nothing while the running build is the live one", async () => {
    const { deps, heal } = setup({ fetchManifest: async () => manifestWith(OLD) });
    expect(await heal()).toBe("current");
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("leaves an ordinary deploy to the browser's update instead of wiping every cache", async () => {
    const incoming = new FakeWorker("installing");
    const { reg, deps, heal } = setup({
      update: async () => {
        reg.installing = incoming as unknown as ServiceWorker;
      },
    });
    const run = heal();
    setTimeout(() => incoming.moveTo("activated"), 5);
    expect(await run).toBe("updating");
    expect(deps.dropWorkersAndCaches).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("heals a worker that finds nothing to install while serving a build the live sw.js no longer lists", async () => {
    const { deps, heal } = setup();
    expect(await heal()).toBe("healed");
    expect(deps.dropWorkersAndCaches).toHaveBeenCalledOnce();
    expect(deps.reload).toHaveBeenCalledOnce();
    expect(deps.storage.getItem(GHOST_SHELL_KEY)).toBe(OLD);
  });

  it("heals when the update's install fails", async () => {
    const incoming = new FakeWorker("installing");
    const { reg, deps, heal } = setup({
      update: async () => {
        reg.installing = incoming as unknown as ServiceWorker;
      },
    });
    const run = heal();
    setTimeout(() => incoming.moveTo("redundant"), 5);
    expect(await run).toBe("healed");
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("does not loop when the reload lands on the same stale build, but heals the next stale build", async () => {
    const storage = memoryStorage();
    storage.setItem(GHOST_SHELL_KEY, OLD);
    const first = setup({ storage });
    expect(await first.heal()).toBe("guarded");
    expect(first.deps.reload).not.toHaveBeenCalled();

    // A later deploy leaves this tab on another stale build: it heals again.
    const second = setup({ storage, ownChunk: NEW, fetchManifest: async () => manifestWith("index-Newer333.js") });
    expect(await second.heal()).toBe("healed");
  });

  it("ignores an error page served in place of sw.js", async () => {
    const { deps, heal } = setup({ fetchManifest: async () => "<html>502 Bad Gateway</html>" });
    expect(await heal()).toBe("skipped");
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("runs one check at a time", async () => {
    let release!: () => void;
    const { heal } = setup({ fetchManifest: () => new Promise((r) => { release = () => r(manifestWith(OLD)); }) });
    const first = heal();
    expect(await heal()).toBe("skipped");
    release();
    expect(await first).toBe("current");
  });
});
