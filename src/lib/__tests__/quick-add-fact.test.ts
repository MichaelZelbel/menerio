import { describe, expect, it } from "vitest";
import { splitFactInput, buildClassifyBody } from "../quick-add-fact";

describe("splitFactInput", () => {
  it("splits 'label: value' into label + value", () => {
    expect(splitFactInput("shoe size: 38")).toEqual({
      mode: "label",
      label: "shoe size",
      value: "38",
    });
  });

  it("splits on the FIRST colon only", () => {
    expect(splitFactInput("time: 10:30")).toEqual({
      mode: "label",
      label: "time",
      value: "10:30",
    });
  });

  it("trims whitespace on both sides", () => {
    expect(splitFactInput("  favorite hair color  :   red  ")).toEqual({
      mode: "label",
      label: "favorite hair color",
      value: "red",
    });
  });

  it("falls back to text mode when there is no colon", () => {
    expect(splitFactInput("loves hotpot")).toEqual({
      mode: "text",
      text: "loves hotpot",
    });
  });

  it("falls back to text mode when the value side is empty", () => {
    expect(splitFactInput("nickname:")).toEqual({
      mode: "text",
      text: "nickname:",
    });
    expect(splitFactInput("nickname:   ")).toEqual({
      mode: "text",
      text: "nickname:",
    });
  });

  it("falls back to text mode when the label side is empty", () => {
    expect(splitFactInput(":  red")).toEqual({
      mode: "text",
      text: ":  red",
    });
  });

  it("trims the whole string in text mode", () => {
    expect(splitFactInput("   just a thought   ")).toEqual({
      mode: "text",
      text: "just a thought",
    });
  });
});

describe("buildClassifyBody", () => {
  it("shapes a label/value request when a colon is present", () => {
    expect(buildClassifyBody("c1", "email: a@b.com")).toEqual({
      contact_id: "c1",
      label: "email",
      value: "a@b.com",
    });
  });

  it("shapes a freeform text request when no colon is present", () => {
    expect(buildClassifyBody("c1", "loves hotpot")).toEqual({
      contact_id: "c1",
      text: "loves hotpot",
    });
  });
});
