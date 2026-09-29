import { describe, expect, it } from "vitest";
import { timeZoneToAdopt } from "../profile-timezone";

describe("timeZoneToAdopt", () => {
  it("adopts the browser's zone while the profile has the UTC default", () => {
    expect(timeZoneToAdopt("UTC", "Europe/Berlin")).toBe("Europe/Berlin");
    expect(timeZoneToAdopt(null, "America/New_York")).toBe("America/New_York");
    expect(timeZoneToAdopt("", "Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("never replaces a zone that is already set, so travelling keeps the dates", () => {
    expect(timeZoneToAdopt("Europe/Berlin", "America/New_York")).toBeNull();
  });

  it("writes nothing when the browser is on UTC or reports nothing", () => {
    expect(timeZoneToAdopt("UTC", "UTC")).toBeNull();
    expect(timeZoneToAdopt("UTC", "Etc/UTC")).toBeNull();
    expect(timeZoneToAdopt("UTC", undefined)).toBeNull();
  });

  it("refuses a name the platform does not know", () => {
    expect(timeZoneToAdopt("UTC", "Mars/Olympus_Mons")).toBeNull();
  });
});
