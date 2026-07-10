import { describe, it, expect } from "vitest";
import { applyBrandTitle } from "@/lib/brand";
import { brandForId } from "@/brands";

describe("applyBrandTitle", () => {
  it("keeps Menerio-suffixed titles byte-identical on the Menerio brand", () => {
    expect(applyBrandTitle("Dashboard — Menerio", " — Menerio")).toBe("Dashboard — Menerio");
    expect(applyBrandTitle("Notes — Menerio", " — Menerio")).toBe("Notes — Menerio");
  });

  it("swaps the suffix for another brand", () => {
    expect(applyBrandTitle("Dashboard — Menerio", " — Cherishly")).toBe("Dashboard — Cherishly");
  });

  it("handles hyphen and en-dash suffix variants", () => {
    expect(applyBrandTitle("Notes - Menerio", " — Cherishly")).toBe("Notes — Cherishly");
    expect(applyBrandTitle("Notes – Menerio", " — Cherishly")).toBe("Notes — Cherishly");
  });

  it("passes brand-first and unsuffixed titles through untouched", () => {
    expect(applyBrandTitle("Menerio — One Brain. Every AI.", " — Cherishly")).toBe(
      "Menerio — One Brain. Every AI.",
    );
    expect(applyBrandTitle("Plain Title", " — Cherishly")).toBe("Plain Title");
  });
});

describe("brandForId", () => {
  it("defaults to menerio for missing or unknown ids", () => {
    expect(brandForId(undefined).id).toBe("menerio");
    expect(brandForId(null).id).toBe("menerio");
    expect(brandForId("nonsense").id).toBe("menerio");
  });

  it("resolves cherishly", () => {
    expect(brandForId("cherishly").id).toBe("cherishly");
    expect(brandForId("cherishly").defaultTheme).toBe("light");
  });
});
