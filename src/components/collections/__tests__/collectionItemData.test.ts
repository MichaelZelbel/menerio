import { describe, expect, it } from "vitest";
import { duplicateItemData, mergeItemData } from "../collectionItemData";

describe("mergeItemData", () => {
  it("keeps keys the form does not know about", () => {
    const stored = { title: "Dune", old_price: 12, duplicated_from: "item-1", mcp_note: "from the AI" };
    expect(mergeItemData(stored, { title: "Dune Messiah" }, ["title"])).toEqual({
      title: "Dune Messiah",
      old_price: 12,
      duplicated_from: "item-1",
      mcp_note: "from the AI",
    });
  });

  it("removes a field the person cleared", () => {
    expect(mergeItemData({ title: "Dune", rating: 5 }, { title: "Dune" }, ["title", "rating"])).toEqual({
      title: "Dune",
    });
  });

  it("leaves a field the person did not change as stored, even if the AI changed it meanwhile", () => {
    const stored = { title: "Dune", status: "Read" };
    expect(mergeItemData(stored, { title: "Dune (1965)", status: "Unread" }, ["title"])).toEqual({
      title: "Dune (1965)",
      status: "Read",
    });
  });

  it("builds a new item from the form alone", () => {
    expect(mergeItemData(undefined, { title: "New" }, ["title", "rating"])).toEqual({ title: "New" });
  });
});

describe("duplicateItemData", () => {
  it("writes the suffixed title into the primary field, where the database reads the title", () => {
    expect(duplicateItemData({ name: "Dune", year: 1965 }, "src", { key: "name", type: "text" }, "Dune 2")).toEqual({
      name: "Dune 2",
      year: 1965,
      duplicated_from: "src",
    });
  });

  it("leaves a primary field that cannot hold text alone", () => {
    expect(duplicateItemData({ amount: 5 }, "src", { key: "amount", type: "number" }, "5 2")).toEqual({
      amount: 5,
      duplicated_from: "src",
    });
  });
});
