// Pure tree-building logic for the Collections sidebar.
//
// Kept free of React and Supabase so it can be unit-tested directly. Folders
// are strictly single-parent (each item has at most one folder_id, and each
// folder has at most one parent_folder_id) — the intuitive folder model, and
// the one that maps cleanly to a filesystem path for future Obsidian/Git
// export.

export interface FolderLite {
  id: string;
  name: string;
  parent_folder_id: string | null;
}

export interface ItemLite {
  id: string;
  title: string | null;
  folder_id: string | null;
  is_favorite?: boolean;
  last_viewed_at?: string | null;
  updated_at?: string;
}

export interface FolderTreeNode {
  folder: FolderLite;
  children: FolderTreeNode[];
  items: ItemLite[];
  /** Items directly in this folder. */
  directCount: number;
  /** Items in this folder + all descendant folders. */
  subtreeCount: number;
}

export interface CollectionItemsTreeResult {
  roots: FolderTreeNode[];
  looseItems: ItemLite[];
}

const byTitle = (a: ItemLite, b: ItemLite) =>
  (a.title ?? "").localeCompare(b.title ?? "");
const byName = (a: FolderLite, b: FolderLite) => a.name.localeCompare(b.name);

/**
 * Assemble the folder tree plus the loose-items bucket.
 *
 * - Roots = folders with no parent, or whose parent is missing (orphan guard).
 * - Items with `folder_id` pointing at an unknown folder fall back to "loose".
 * - `subtreeCount` = plain sum: single-parent means each item appears in
 *   exactly one folder path, so no dedupe is needed.
 */
export function buildCollectionItemsTree(input: {
  items: ItemLite[];
  folders: FolderLite[];
}): CollectionItemsTreeResult {
  const { items, folders } = input;

  const nodeById = new Map<string, FolderTreeNode>();
  folders.forEach((folder) => {
    nodeById.set(folder.id, {
      folder,
      children: [],
      items: [],
      directCount: 0,
      subtreeCount: 0,
    });
  });

  const looseItems: ItemLite[] = [];
  items.forEach((item) => {
    if (!item.folder_id) {
      looseItems.push(item);
      return;
    }
    const node = nodeById.get(item.folder_id);
    if (!node) {
      // Folder was deleted (FK is set null) or filtered out — treat as loose.
      looseItems.push(item);
      return;
    }
    node.items.push(item);
  });

  const roots: FolderTreeNode[] = [];
  folders.forEach((folder) => {
    const node = nodeById.get(folder.id)!;
    const parent = folder.parent_folder_id
      ? nodeById.get(folder.parent_folder_id)
      : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const finalize = (node: FolderTreeNode): number => {
    node.children.sort((a, b) => byName(a.folder, b.folder));
    node.items.sort(byTitle);
    node.directCount = node.items.length;
    let total = node.directCount;
    node.children.forEach((child) => {
      total += finalize(child);
    });
    node.subtreeCount = total;
    return total;
  };
  roots.forEach(finalize);
  roots.sort((a, b) => byName(a.folder, b.folder));
  looseItems.sort(byTitle);

  return { roots, looseItems };
}

/**
 * Client-side cycle guard for drag-to-reparent. Dropping `draggedId` onto
 * `targetId` would set dragged's parent to target; that creates a cycle iff
 * target is dragged itself or a descendant of dragged. The DB trigger is the
 * authoritative backstop.
 */
export function wouldCreateFolderCycle(
  folders: FolderLite[],
  draggedId: string,
  targetId: string,
): boolean {
  const parentById = new Map<string, string | null>();
  folders.forEach((f) => parentById.set(f.id, f.parent_folder_id ?? null));

  const visited = new Set<string>();
  let current: string | null | undefined = targetId;
  while (current) {
    if (current === draggedId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}
