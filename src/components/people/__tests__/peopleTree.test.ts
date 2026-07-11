import { describe, it, expect } from "vitest";
import {
  buildPeopleTree,
  wouldCreateCycle,
  type GroupLite,
  type PersonLite,
  type MembershipLite,
} from "../peopleTreeBuild";

const person = (id: string, over: Partial<PersonLite> = {}): PersonLite => ({
  id,
  name: id,
  is_favorite: false,
  aliases: [],
  last_viewed_at: null,
  ...over,
});

const group = (id: string, over: Partial<GroupLite> = {}): GroupLite => ({
  id,
  name: id,
  parent_group_id: null,
  archived_at: null,
  is_trashed: false,
  slug: id,
  icon: null,
  ...over,
});

const membership = (groupId: string, contactId: string): MembershipLite => ({
  group_id: groupId,
  contact_id: contactId,
});

describe("buildPeopleTree — nesting", () => {
  it("nests a child group under its parent", () => {
    const groups = [group("a"), group("b", { parent_group_id: "a" })];
    const { roots } = buildPeopleTree({ people: [], groups, memberships: [] });

    expect(roots.map((n) => n.group.id)).toEqual(["a"]);
    expect(roots[0].children.map((n) => n.group.id)).toEqual(["b"]);
  });

  it("sorts sibling groups and people by name", () => {
    const groups = [group("z", { name: "Zed" }), group("a", { name: "Alpha" })];
    const people = [person("p2", { name: "Bob" }), person("p1", { name: "Ana" })];
    const memberships = [membership("a", "p1"), membership("a", "p2")];
    const { roots } = buildPeopleTree({ people, groups, memberships });

    expect(roots.map((n) => n.group.name)).toEqual(["Alpha", "Zed"]);
    const alpha = roots.find((n) => n.group.name === "Alpha")!;
    expect(alpha.people.map((p) => p.name)).toEqual(["Ana", "Bob"]);
  });
});

describe("buildPeopleTree — subtree counts (dedup)", () => {
  it("counts a person in two sibling subgroups once in the shared ancestor", () => {
    const groups = [
      group("a"),
      group("b", { parent_group_id: "a" }),
      group("c", { parent_group_id: "a" }),
    ];
    const memberships = [membership("b", "p1"), membership("c", "p1")];
    const { roots } = buildPeopleTree({ people: [person("p1")], groups, memberships });

    const a = roots[0];
    expect(a.directCount).toBe(0);
    expect(a.subtreeCount).toBe(1);
    const b = a.children.find((n) => n.group.id === "b")!;
    expect(b.directCount).toBe(1);
    expect(b.subtreeCount).toBe(1);
  });

  it("counts a person who is both a direct and a descendant member once", () => {
    const groups = [group("a"), group("b", { parent_group_id: "a" })];
    const memberships = [membership("a", "p1"), membership("b", "p1")];
    const { roots } = buildPeopleTree({ people: [person("p1")], groups, memberships });

    const a = roots[0];
    expect(a.directCount).toBe(1);
    expect(a.subtreeCount).toBe(1);
  });

  it("dedupes duplicate direct membership rows", () => {
    const groups = [group("a")];
    const memberships = [membership("a", "p1"), membership("a", "p1")];
    const { roots } = buildPeopleTree({ people: [person("p1")], groups, memberships });

    expect(roots[0].directCount).toBe(1);
    expect(roots[0].people).toHaveLength(1);
  });
});

describe("buildPeopleTree — orphan guard", () => {
  it("promotes a group whose parent is missing to a root", () => {
    const groups = [group("b", { parent_group_id: "ghost" })];
    const { roots } = buildPeopleTree({ people: [], groups, memberships: [] });
    expect(roots.map((n) => n.group.id)).toEqual(["b"]);
  });

  it("promotes a group whose parent is archived to a root", () => {
    const groups = [
      group("a", { archived_at: "2026-01-01T00:00:00Z" }),
      group("b", { parent_group_id: "a" }),
    ];
    const { roots } = buildPeopleTree({ people: [], groups, memberships: [] });
    // archived parent excluded; child promoted to root
    expect(roots.map((n) => n.group.id)).toEqual(["b"]);
  });

  it("promotes a group whose parent is trashed to a root", () => {
    const groups = [
      group("a", { is_trashed: true }),
      group("b", { parent_group_id: "a" }),
    ];
    const { roots } = buildPeopleTree({ people: [], groups, memberships: [] });
    expect(roots.map((n) => n.group.id)).toEqual(["b"]);
  });
});

describe("buildPeopleTree — archived/trashed exclusion", () => {
  it("excludes archived and trashed groups entirely", () => {
    const groups = [
      group("a"),
      group("arch", { archived_at: "2026-01-01T00:00:00Z" }),
      group("trash", { is_trashed: true }),
    ];
    const { roots } = buildPeopleTree({ people: [], groups, memberships: [] });
    expect(roots.map((n) => n.group.id)).toEqual(["a"]);
  });

  it("does not count members of an archived group in a live sibling's subtree", () => {
    const groups = [
      group("a"),
      group("arch", { parent_group_id: "a", archived_at: "2026-01-01T00:00:00Z" }),
    ];
    const memberships = [membership("arch", "p1")];
    const { roots } = buildPeopleTree({ people: [person("p1")], groups, memberships });
    expect(roots[0].subtreeCount).toBe(0);
  });
});

describe("buildPeopleTree — ungrouped", () => {
  it("lists people with no active-group membership, sorted by name", () => {
    const groups = [group("a")];
    const people = [
      person("p1", { name: "Zoe" }),
      person("p2", { name: "Amy" }),
      person("p3", { name: "Bea" }),
    ];
    const memberships = [membership("a", "p1")];
    const { ungrouped } = buildPeopleTree({ people, groups, memberships });
    expect(ungrouped.map((p) => p.name)).toEqual(["Amy", "Bea"]);
  });

  it("treats a person whose only membership is to an archived group as ungrouped", () => {
    const groups = [group("arch", { archived_at: "2026-01-01T00:00:00Z" })];
    const memberships = [membership("arch", "p1")];
    const { ungrouped } = buildPeopleTree({ people: [person("p1")], groups, memberships });
    expect(ungrouped.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("wouldCreateCycle", () => {
  const chain: GroupLite[] = [
    group("a"),
    group("b", { parent_group_id: "a" }),
    group("c", { parent_group_id: "b" }),
  ];

  it("rejects dropping a group onto itself", () => {
    expect(wouldCreateCycle(chain, "a", "a")).toBe(true);
  });

  it("rejects dropping an ancestor onto its own descendant", () => {
    // dragging a onto c would make a a child of c, but c descends from a
    expect(wouldCreateCycle(chain, "a", "c")).toBe(true);
    expect(wouldCreateCycle(chain, "b", "c")).toBe(true);
  });

  it("allows reparenting onto an unrelated group", () => {
    const groups = [...chain, group("d")];
    expect(wouldCreateCycle(groups, "d", "c")).toBe(false);
    expect(wouldCreateCycle(groups, "c", "d")).toBe(false);
  });

  it("allows moving a descendant to a shallower unrelated branch", () => {
    const groups = [group("a"), group("b", { parent_group_id: "a" }), group("x")];
    expect(wouldCreateCycle(groups, "b", "x")).toBe(false);
  });

  it("terminates on pre-existing malformed cycles without hanging", () => {
    const malformed = [
      group("a", { parent_group_id: "b" }),
      group("b", { parent_group_id: "a" }),
    ];
    // Should return a boolean, not hang.
    expect(typeof wouldCreateCycle(malformed, "z", "a")).toBe("boolean");
  });
});
