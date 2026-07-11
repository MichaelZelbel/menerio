import { describe, it, expect } from "vitest";
import { shouldTouchViewed, shouldTouchLoadedPerson } from "../usePeople";

describe("shouldTouchViewed", () => {
  it("touches when the person has never been viewed", () => {
    expect(shouldTouchViewed(null, new Date("2026-07-11T12:00:00Z"))).toBe(true);
  });

  it("skips when last viewed under 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T12:04:59Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(false);
  });

  it("touches when last viewed exactly 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T12:05:00Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(true);
  });

  it("touches when last viewed well over 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T13:00:00Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(true);
  });

  it("touches when last_viewed_at is an unparseable value", () => {
    expect(shouldTouchViewed("not-a-date", new Date("2026-07-11T12:00:00Z"))).toBe(true);
  });
});

describe("shouldTouchLoadedPerson", () => {
  const now = new Date("2026-07-11T12:00:00Z");

  it("never touches when the row is not loaded yet (empty cache is not 'never viewed')", () => {
    expect(shouldTouchLoadedPerson(undefined, now)).toBe(false);
  });

  it("touches when the loaded row has never been viewed", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: null }, now)).toBe(true);
  });

  it("skips when the loaded row was viewed under 5 minutes ago", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: "2026-07-11T11:58:00Z" }, now)).toBe(false);
  });

  it("touches when the loaded row was viewed over 5 minutes ago", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: "2026-07-11T11:00:00Z" }, now)).toBe(true);
  });

  it("touches when the loaded row's last_viewed_at is undefined (pre-migration cache)", () => {
    expect(shouldTouchLoadedPerson({}, now)).toBe(true);
  });
});
