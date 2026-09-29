import { describe, expect, it } from "vitest";
import {
  duplicateField,
  newField,
  parseSchema,
  relabelField,
  toJsonSchema,
  validateFields,
} from "../schemaFields";

describe("collection schema fields", () => {
  it("keeps a saved field's key when its label changes, so items keep their values", () => {
    const [price] = parseSchema([{ key: "price", label: "Price", type: "number" }]);
    const renamed = relabelField(price, "Price ($)");
    expect(renamed.label).toBe("Price ($)");
    expect(renamed.key).toBe("price");
  });

  it("keeps the primary field's key when it is renamed", () => {
    const [name] = parseSchema([{ key: "name", label: "Name", type: "text", primary: true }]);
    expect(relabelField(name, "Book title").key).toBe("name");
  });

  it("lets a field added in this session take its key from its label", () => {
    expect(relabelField(newField(), "Due date").key).toBe("due_date");
    const copy = duplicateField(parseSchema([{ key: "price", label: "Price", type: "number" }])[0]);
    expect(copy.key).toBe("price_copy");
    expect(relabelField(copy, "Old price").key).toBe("old_price");
  });

  it("never writes the new-field marker to the saved schema", () => {
    const saved = toJsonSchema([relabelField(newField(), "Due date")]);
    expect(saved).toEqual([{ key: "due_date", label: "Due date", type: "text" }]);
  });

  it("rejects two fields that would store their values under one key", () => {
    const fields = [
      ...parseSchema([{ key: "price", label: "Price", type: "number", primary: true }]),
      relabelField(newField(), "Price ($)"),
    ];
    const errors = validateFields(fields);
    expect(errors[fields[0].id]).toEqual(['Another field already uses the key "price".']);
    expect(errors[fields[1].id]).toEqual([
      'Another field already uses the key "price". Choose a different label.',
    ]);
  });

  it("reports a duplicate label once instead of also reporting the shared key", () => {
    const fields = [relabelField(newField(), "Price"), relabelField(newField(), "price")];
    const errors = validateFields(fields);
    expect(errors[fields[0].id]).toEqual(["Label must be unique."]);
  });

  it("accepts distinct keys", () => {
    const fields = parseSchema([
      { key: "title", label: "Title", type: "text", primary: true },
      { key: "price", label: "Price", type: "number" },
    ]);
    expect(validateFields(fields)).toEqual({});
  });
});
