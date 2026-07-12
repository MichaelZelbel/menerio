import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
} from "../../supabase/functions/_shared/frontmatter";
import {
  buildGroupMarkdown,
  buildGroupPath,
  buildPersonMarkdown,
  buildPersonPath,
  contentEffectivelyEqual,
  parseGroupMarkdown,
  parsePersonMarkdown,
  pathMatchesName,
  VaultParseError,
} from "../../supabase/functions/_shared/people-vault";

describe("frontmatter parser", () => {
  it("parses inline lists, booleans, and quoted scalars", () => {
    const { data, hasFrontmatter } = parseFrontmatter(
      `---\nname: "Jane Doe"\ntags: ["ai", "climbing"]\nfavorite: true\nsensitive: false\ncompany: Acme\n---\nbody`,
    );
    expect(hasFrontmatter).toBe(true);
    expect(data.name).toBe("Jane Doe");
    expect(data.tags).toEqual(["ai", "climbing"]);
    expect(data.favorite).toBe(true);
    expect(data.sensitive).toBe(false);
    expect(data.company).toBe("Acme");
  });

  it("parses block-style lists (Obsidian Properties format)", () => {
    const { data } = parseFrontmatter(
      `---\ngroups:\n  - Investors\n  - "Berlin Friends"\nname: Jane\n---\nbody`,
    );
    expect(data.groups).toEqual(["Investors", "Berlin Friends"]);
    expect(data.name).toBe("Jane");
  });

  it("handles CRLF line endings", () => {
    const { data, body } = parseFrontmatter(
      `---\r\nname: Jane\r\ngroups:\r\n  - Investors\r\n---\r\nbody text`,
    );
    expect(data.name).toBe("Jane");
    expect(data.groups).toEqual(["Investors"]);
    expect(body).toBe("body text");
  });

  it("distinguishes empty scalar from block list", () => {
    const { data } = parseFrontmatter(`---\ncompany: \nname: Jane\n---\n`);
    expect(data.company).toBe("");
    expect(data.name).toBe("Jane");
  });

  it("reports missing frontmatter", () => {
    const { hasFrontmatter, body } = parseFrontmatter("just text");
    expect(hasFrontmatter).toBe(false);
    expect(body).toBe("just text");
  });

  it("round-trips through serializeFrontmatter", () => {
    const block = serializeFrontmatter([
      ["id", "3f1c2a9e-8d4b-4c1a-9e7f-1a2b3c4d5e6f"],
      ["name", 'Jane "JD" Doe'],
      ["groups", ["Investors", "Berlin Friends"]],
      ["favorite", true],
      ["company", null],
      ["skipped", undefined],
    ]);
    const { data } = parseFrontmatter(block + "\nbody");
    expect(data.id).toBe("3f1c2a9e-8d4b-4c1a-9e7f-1a2b3c4d5e6f");
    expect(data.name).toBe('Jane "JD" Doe');
    expect(data.groups).toEqual(["Investors", "Berlin Friends"]);
    expect(data.favorite).toBe(true);
    expect(data.company).toBe("");
    expect("skipped" in data).toBe(false);
  });
});

const contact = {
  id: "3f1c2a9e-8d4b-4c1a-9e7f-1a2b3c4d5e6f",
  name: "Jane Doe",
  company: "Acme GmbH",
  role: "CTO",
  relationship: "friend",
  email: "jane@acme.example",
  phone: "+49 170 0000000",
  tags: ["ai"],
  aliases: ["JD"],
  is_favorite: true,
  is_sensitive: false,
  notes: "Met at the climbing gym.\n\nLoves hotpot.",
  created_at: "2026-03-29T20:23:45+00:00",
  updated_at: "2026-07-12T09:14:03+00:00",
};

describe("person pages", () => {
  it("round-trips every writable field", () => {
    const md = buildPersonMarkdown({
      contact,
      groupNames: ["Investors", "Berlin Friends"],
      categories: [
        { id: "cat-1", name: "Personal", sort_order: 1 },
        { id: "cat-2", name: "Preferences", sort_order: 2 },
      ],
      entries: [
        { category_id: "cat-1", label: "Birthday", value: "March 3", is_pinned: true, sort_order: 1 },
        { category_id: "cat-2", label: "Food", value: "loves hotpot", is_pinned: false, sort_order: 1 },
      ],
    });

    const parsed = parsePersonMarkdown(md);
    expect(parsed.id).toBe(contact.id);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.core.company).toBe("Acme GmbH");
    expect(parsed.core.role).toBe("CTO");
    expect(parsed.core.relationship).toBe("friend");
    expect(parsed.core.email).toBe("jane@acme.example");
    expect(parsed.core.phone).toBe("+49 170 0000000");
    expect(parsed.tags).toEqual(["ai"]);
    expect(parsed.aliases).toEqual(["JD"]);
    expect(parsed.groups).toEqual(["Berlin Friends", "Investors"]); // sorted on export
    expect(parsed.favorite).toBe(true);
    expect(parsed.sensitive).toBe(false);
    expect(parsed.notesBody).toBe("Met at the climbing gym.\n\nLoves hotpot.");
    // Facts render inside markers (regenerated-only region).
    expect(md).toContain("## Highlights");
    expect(md).toContain("- **Birthday:** March 3");
    expect(md).toContain("## Preferences");
  });

  it("null core fields round-trip as explicit empty values", () => {
    const md = buildPersonMarkdown({
      contact: { ...contact, company: null, email: null, notes: null, tags: [], aliases: [] },
      groupNames: [],
      categories: [],
      entries: [],
    });
    const parsed = parsePersonMarkdown(md);
    expect(parsed.core.company).toBeNull();
    expect(parsed.core.email).toBeNull();
    expect(parsed.groups).toEqual([]); // explicit empty list = clear memberships
    expect(parsed.notesBody).toBe("");
  });

  it("absent groups key parses as null (membership unchanged)", () => {
    const parsed = parsePersonMarkdown(`---\nname: Jane\n---\nbody`, { requireMarkers: false });
    expect(parsed.groups).toBeNull();
    expect(parsed.favorite).toBeNull();
    expect(parsed.core.company).toBeUndefined();
  });

  it("throws when markers are missing on a tracked file", () => {
    expect(() => parsePersonMarkdown(`---\nname: Jane\n---\nno markers here`)).toThrow(VaultParseError);
  });

  it("lenient mode uses the whole body minus the heading as notes", () => {
    const parsed = parsePersonMarkdown(`---\nname: Jane\n---\n# Jane\n\nSome notes.`, {
      requireMarkers: false,
    });
    expect(parsed.notesBody).toBe("Some notes.");
  });
});

describe("group pages", () => {
  const group = {
    id: "7a9b1c3d-2e4f-4a6b-8c0d-9e1f2a3b4c5d",
    name: "Investors",
    type: "investors",
    sensitivity: "normal",
    purpose: "Raise the seed round.",
    description: "Warm intros preferred.",
    created_at: "2026-04-28T19:54:18+00:00",
    updated_at: "2026-07-11T21:35:34+00:00",
  };

  it("round-trips writable fields; member table stays read-only", () => {
    const md = buildGroupMarkdown({
      group,
      parentName: "Network",
      members: [{ name: "Jane Doe", status: "warm", priority: "high", reason: "intro via Max" }],
    });
    const parsed = parseGroupMarkdown(md);
    expect(parsed.id).toBe(group.id);
    expect(parsed.name).toBe("Investors");
    expect(parsed.parent).toBe("Network");
    expect(parsed.groupType).toBe("investors");
    expect(parsed.sensitivity).toBe("normal");
    expect(parsed.purpose).toBe("Raise the seed round.");
    expect(parsed.description).toBe("Warm intros preferred.");
    expect(md).toContain("| [[Jane Doe]] | warm | high | intro via Max |");
  });

  it("explicit empty parent clears; absent parent leaves unchanged", () => {
    const cleared = buildGroupMarkdown({ group, parentName: null, members: [] });
    expect(parseGroupMarkdown(cleared).parent).toBeNull();
    const absent = parseGroupMarkdown(`---\nname: Investors\n---\nbody`, { requireMarkers: false });
    expect(absent.parent).toBeUndefined();
  });

  it("throws when member markers are missing on a tracked file", () => {
    expect(() => parseGroupMarkdown(`---\nname: Investors\n---\nno markers`)).toThrow(VaultParseError);
  });
});

describe("paths and rename detection", () => {
  it("builds sanitized paths under the vault", () => {
    expect(buildPersonPath("/", 'Jane <D>oe?')).toBe("People/Jane Doe.md");
    expect(buildGroupPath("vault/sub", "Investors")).toBe("vault/sub/Groups/Investors.md");
  });

  it("pathMatchesName tolerates collision suffixes but not renames", () => {
    expect(pathMatchesName("People/Jane Doe.md", "Jane Doe")).toBe(true);
    expect(pathMatchesName("People/Jane Doe 2.md", "Jane Doe")).toBe(true);
    expect(pathMatchesName("People/Jane Doe.md", "Jane Smith")).toBe(false);
  });

  it("contentEffectivelyEqual ignores only the modified line", () => {
    const a = `---\nid: x\nmodified: 2026-07-12T09:00:00Z\n---\nbody`;
    const b = `---\nid: x\nmodified: 2026-07-12T10:30:00Z\n---\nbody`;
    const c = `---\nid: x\nmodified: 2026-07-12T10:30:00Z\n---\nother body`;
    expect(contentEffectivelyEqual(a, b)).toBe(true);
    expect(contentEffectivelyEqual(a, c)).toBe(false);
  });
});
