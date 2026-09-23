import { describe, expect, it } from "vitest";
import { secretEquals } from "../secret-equals.ts";

describe("secretEquals", () => {
  it("matches only the identical secret", async () => {
    expect(await secretEquals("s3cret-value", "s3cret-value")).toBe(true);
    expect(await secretEquals("s3cret-valuX", "s3cret-value")).toBe(false);
    expect(await secretEquals("s3cret", "s3cret-value")).toBe(false);
  });

  it("never lets an empty or missing value through", async () => {
    expect(await secretEquals("", "")).toBe(false);
    expect(await secretEquals(null, "x")).toBe(false);
    expect(await secretEquals("x", undefined)).toBe(false);
    expect(await secretEquals(undefined, undefined)).toBe(false);
    expect(await secretEquals("", undefined)).toBe(false);
  });
});
