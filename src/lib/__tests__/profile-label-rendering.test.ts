import { describe, expect, it } from "vitest";
import { displayLabel, splitProfileValues } from "@/lib/profile-list-labels";
import { guardNameValue } from "../../../supabase/functions/_shared/profile-name-guard.ts";
import { isKnownCanonicalLabel, canonicalProfileLabel } from "../../../supabase/functions/_shared/profile-canonical-schema.ts";

describe("label canonicalization", () => {
  it("maps name synonyms onto Nickname in the UI", () => {
    for (const l of ["Name alias", "Alternative name", "Aka", "Other names", "Nicknames"]) {
      expect(displayLabel(l)).toBe("Nickname");
    }
  });

  it("keeps localized birth names distinct from nicknames", () => {
    expect(displayLabel("Japanese name")).toBe("Name (Japanese)");
  });

  it("canonicalizes the same synonyms on the write path", () => {
    for (const l of ["name alias", "alternative name", "other names"]) {
      expect(canonicalProfileLabel("identity", l)).toBe("Nickname");
    }
  });

  it("flags labels the schema does not know so they cannot auto-apply", () => {
    expect(isKnownCanonicalLabel("identity", "Nickname")).toBe(true);
    expect(isKnownCanonicalLabel("identity", "Name alias")).toBe(true);
    expect(isKnownCanonicalLabel("identity", "Vibe descriptor")).toBe(false);
  });
});

describe("multi-value rendering", () => {
  it("splits comma-packed list values into individual values", () => {
    expect(splitProfileValues("Nickname", "Yumi, Mimi, Chocola")).toEqual(["Yumi", "Mimi", "Chocola"]);
  });

  it("does not split single-fact labels", () => {
    expect(splitProfileValues("Current city", "Frankfurt am Main, Germany")).toEqual([
      "Frankfurt am Main, Germany",
    ]);
  });
});

describe("name guard", () => {
  it("drops mixed-alphabet noise", () => {
    expect(guardNameValue({ label: "Nickname", value: "yaunderε" }).action).toBe("drop");
  });

  it("routes handle-shaped values to Online handle", () => {
    const d = guardNameValue({ label: "Nickname", value: "ChocolaJoy" });
    expect(d).toMatchObject({ action: "relabel", label: "Online handle" });
    expect(guardNameValue({ label: "Nickname", value: "@yumei" }).action).toBe("relabel");
  });

  it("drops a nickname that just repeats the person's name", () => {
    expect(guardNameValue({ label: "Nickname", value: "yumei ", personName: "Yumei" }).action).toBe("drop");
  });

  it("keeps real names, including particles and non-Latin scripts", () => {
    for (const v of ["Yumi", "McDonald", "O'Brien", "美惠", "Ελένη"]) {
      expect(guardNameValue({ label: "Nickname", value: v }).action).toBe("keep");
    }
  });
});
