import { describe, it, expect } from "vitest";
import { isPastDay, localDateISO, parseDateOnly } from "../local-date";

describe("parseDateOnly", () => {
  it("reads a date-only value as that day in local time, in any timezone", () => {
    const d = parseDateOnly("2026-09-16")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 16, 0]);
  });

  it("reads a moment stored at UTC midnight as its stored day", () => {
    const d = parseDateOnly("2026-09-16T00:00:00+00:00")!;
    expect(localDateISO(d)).toBe("2026-09-16");
  });

  it("returns null for nothing or garbage", () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly("not a date")).toBeNull();
  });
});

describe("isPastDay", () => {
  it("does not call something due today overdue, early or late in the local day", () => {
    expect(isPastDay("2026-09-16", new Date(2026, 8, 16, 0, 30))).toBe(false);
    expect(isPastDay("2026-09-16", new Date(2026, 8, 16, 23, 30))).toBe(false);
  });

  it("calls yesterday overdue and tomorrow not", () => {
    const now = new Date(2026, 8, 16, 12, 0);
    expect(isPastDay("2026-09-15", now)).toBe(true);
    expect(isPastDay("2026-09-17", now)).toBe(false);
  });

  it("treats a missing due date as not overdue", () => {
    expect(isPastDay(null)).toBe(false);
  });
});
