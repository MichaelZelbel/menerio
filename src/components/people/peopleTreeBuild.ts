// Pure tree-building logic for the People group sidebar.
//
// Kept free of React and Supabase so it can be unit-tested directly. The
// PeopleTree component feeds it plain data (people, groups, memberships) and
// renders the resulting node graph. Groups are many-to-many "folders": one
// person can live under several groups, so subtree counts must dedupe by
// contact id rather than summing.

export interface GroupLite {
  id: string;
  name: string;
  parent_group_id: string | null;
  archived_at?: string | null;
  is_trashed?: boolean;
  icon?: string | null;
  slug?: string;
}

export interface PersonLite {
  id: string;
  name: string;
  is_favorite?: boolean;
  aliases?: string[] | null;
  last_viewed_at?: string | null;
}

export interface MembershipLite {
  group_id: string;
  contact_id: string;
}

export interface GroupTreeNode {
  group: GroupLite;
  children: GroupTreeNode[];
  people: PersonLite[];
  /** Unique direct members of this group. */
  directCount: number;
  /** Unique contact ids across this group and all descendants (deduped). */
  subtreeCount: number;
}

export interface PeopleTreeResult {
  roots: GroupTreeNode[];
  ungrouped: PersonLite[];
}

/** A group is visible in the tree only when it is neither archived nor trashed. */
function isActiveGroup(group: GroupLite): boolean {
  return !group.archived_at && !group.is_trashed;
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name);

/**
 * Assemble the group tree plus the ungrouped bucket.
 *
 * - Roots = active groups with no parent, or whose parent is missing/excluded
 *   (orphan guard — a nested group never disappears because its parent was
 *   archived/trashed/deleted).
 * - Archived and trashed groups are dropped entirely, along with their members'
 *   contribution to any live ancestor's counts.
 * - `subtreeCount` unions contact ids bottom-up so a person under several groups
 *   is counted once per ancestor.
 * - Ungrouped = people with no membership to any active group.
 */
export function buildPeopleTree(input: {
  people: PersonLite[];
  groups: GroupLite[];
  memberships: MembershipLite[];
}): PeopleTreeResult {
  const { people, groups, memberships } = input;

  const peopleById = new Map<string, PersonLite>();
  people.forEach((p) => peopleById.set(p.id, p));

  const activeGroups = groups.filter(isActiveGroup);
  const nodeById = new Map<string, GroupTreeNode>();
  activeGroups.forEach((group) => {
    nodeById.set(group.id, {
      group,
      children: [],
      people: [],
      directCount: 0,
      subtreeCount: 0,
    });
  });

  // Direct members per active group (deduped by contact id). Tracks which
  // contact ids are grouped so the ungrouped bucket can exclude them.
  const directIdsByGroup = new Map<string, Set<string>>();
  const groupedContactIds = new Set<string>();
  memberships.forEach(({ group_id, contact_id }) => {
    const node = nodeById.get(group_id);
    if (!node) return; // membership to an excluded/missing group — ignore
    const person = peopleById.get(contact_id);
    // Ghost membership: the contact was merged or deleted, so its row was
    // cascaded/filtered out of `people` but the membership row itself is
    // stale (merge-contacts doesn't clean these up). Ignore it entirely so
    // it never inflates a group's counts or member list.
    if (!person) return;
    groupedContactIds.add(contact_id);
    let set = directIdsByGroup.get(group_id);
    if (!set) {
      set = new Set<string>();
      directIdsByGroup.set(group_id, set);
    }
    if (set.has(contact_id)) return; // duplicate row — dedupe
    set.add(contact_id);
    node.people.push(person);
  });

  directIdsByGroup.forEach((set, groupId) => {
    const node = nodeById.get(groupId);
    if (node) node.directCount = set.size;
  });

  // Link children to parents; collect roots (parent null or excluded/missing).
  const roots: GroupTreeNode[] = [];
  activeGroups.forEach((group) => {
    const node = nodeById.get(group.id)!;
    const parent = group.parent_group_id ? nodeById.get(group.parent_group_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  // Bottom-up unique contact-id union for subtree counts + stable sort.
  const finalize = (node: GroupTreeNode): Set<string> => {
    node.children.sort((a, b) => byName(a.group, b.group));
    node.people.sort(byName);
    const union = new Set<string>(directIdsByGroup.get(node.group.id) ?? []);
    node.children.forEach((child) => {
      finalize(child).forEach((id) => union.add(id));
    });
    node.subtreeCount = union.size;
    return union;
  };
  roots.forEach(finalize);
  roots.sort((a, b) => byName(a.group, b.group));

  const ungrouped = people
    .filter((p) => !groupedContactIds.has(p.id))
    .sort(byName);

  return { roots, ungrouped };
}

/**
 * Client-side cycle guard for drag-to-reparent. Dropping `draggedId` onto
 * `targetId` would set dragged's parent to target; that creates a cycle iff
 * target is dragged itself or a descendant of dragged — i.e. dragged appears
 * in target's ancestor chain. Walks parents up from target with a visited
 * guard so pre-existing malformed data can't hang the UI. The DB trigger is
 * the authoritative backstop.
 */
export function wouldCreateCycle(
  groups: GroupLite[],
  draggedId: string,
  targetId: string,
): boolean {
  const parentById = new Map<string, string | null>();
  groups.forEach((g) => parentById.set(g.id, g.parent_group_id ?? null));

  const visited = new Set<string>();
  let current: string | null | undefined = targetId;
  while (current) {
    if (current === draggedId) return true;
    if (visited.has(current)) return false; // malformed pre-existing cycle
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}
