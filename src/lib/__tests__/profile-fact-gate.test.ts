import { describe, expect, it } from "vitest";
import {
  gateStoredValue,
  routeFact,
  splitToFacts,
  typeOfValue,
} from "@/lib/profile-fact-gate";

describe("typeOfValue", () => {
  it("classifies concrete shapes", () => {
    expect(typeOfValue("hi14miau@gmail.com")).toBe("email");
    expect(typeOfValue("angelcore.club")).toBe("url");
    expect(typeOfValue("1197301158889410562")).toBe("identifier");
    expect(typeOfValue("145 cm")).toBe("measure");
    expect(typeOfValue("Yumei")).toBe("person_name");
    expect(typeOfValue("Wakes up around 5 AM and cleans the whole house")).toBe("sentence");
  });
});

describe("splitToFacts", () => {
  it("keeps a short qualified value whole", () => {
    expect(splitToFacts("Current city", "São Paulo, Brazil")).toEqual(["São Paulo, Brazil"]);
  });

  it("explodes a multi-item bag", () => {
    expect(splitToFacts("Favorite places", "Japanese area in São Paulo, Liberdade, my room")).toEqual([
      "Japanese area in São Paulo",
      "Liberdade",
      "my room",
    ]);
  });

  it("never splits inside parentheses", () => {
    expect(splitToFacts("Favorite restaurants", "McDonald's Happy Meal (nuggets, fries), sushi, KFC")).toEqual([
      "McDonald's Happy Meal (nuggets, fries)",
      "sushi",
      "KFC",
    ]);
  });

  it("drops duplicates inside the bag", () => {
    expect(splitToFacts("Favorite foods", "KFC, kfc, sushi, sushi")).toEqual(["KFC", "sushi"]);
  });

  it("leaves prose labels alone", () => {
    const prose = "We met in 2019 at a conference, then stayed in touch, and later worked together";
    expect(splitToFacts("Professional summary", prose)).toEqual([prose]);
  });
});

describe("routeFact", () => {
  it("moves an email out of a name label", () => {
    const r = routeFact({ label: "Full name", categorySlug: "identity", value: "hi14miau@gmail.com" });
    expect(r.accepted).toBe(true);
    expect(r.label).toBe("Email");
    expect(r.categorySlug).toBe("communication");
  });

  it("honours an inline label inside the value", () => {
    const r = routeFact({
      label: "Full name",
      categorySlug: "identity",
      value: "Occupation: System Analyst",
    });
    expect(r.value).toBe("System Analyst");
    expect(r.label.toLowerCase()).not.toBe("full name");
  });

  it("refuses prose under a name label instead of storing it", () => {
    const r = routeFact({
      label: "Full name",
      categorySlug: "identity",
      value: "Wakes up around 5 AM and cleans the house",
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain("type_mismatch");
  });

  it("accepts a real name", () => {
    const r = routeFact({ label: "Full name", categorySlug: "identity", value: "Yumei" });
    expect(r.accepted).toBe(true);
    expect(r.label).toBe("Full name");
  });

  it("refuses a value that is too long to be one fact", () => {
    const r = routeFact({ label: "Traits", categorySlug: "personality", value: "x".repeat(300) });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("not_atomic");
  });
});

describe("gateStoredValue", () => {
  it("turns a name bag into separately filed facts", () => {
    const results = gateStoredValue({
      label: "Full name",
      categorySlug: "identity",
      value: "Yumei, Yasmin, hi14miau@gmail.com, Occupation: System Analyst",
    });
    expect(results).toHaveLength(4);
    expect(results.find((r) => r.type === "email")?.label).toBe("Email");
    expect(results.filter((r) => r.accepted && r.label === "Full name").map((r) => r.value)).toEqual([
      "Yumei",
      "Yasmin",
    ]);
  });
});
