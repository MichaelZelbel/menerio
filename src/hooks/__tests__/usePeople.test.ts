import { describe, it, expect } from "vitest";
import { shouldTouchViewed } from "../usePeople";

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
