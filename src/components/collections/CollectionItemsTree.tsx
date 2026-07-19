import {
  memo,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  buildCollectionItemsTree,
  wouldCreateFolderCycle,
  type FolderLite,
  type FolderTreeNode,
  type ItemLite,
} from "./collectionItemsTreeBuild";

const FAVORITES_KEY = "__favorites__";
const RECENT_KEY = "__recent__";
const ALL_KEY = "__all__";
const SEARCH_KEY = "__search__";

const DRAG_ITEM = "application/x-collection-item-id";
const DRAG_FOLDER = "application/x-collection-folder-id";

export interface CollectionItemsTreeProps {
  items: ItemLite[];
  folders: FolderLite[];
  selectedItemId: string | null;
  searchQuery: string;
  onSelectItem: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onReparentFolder: (folderId: string, parentFolderId: string | null) => void;
  onMoveItemToFolder: (itemId: string, folderId: string | null) => void;
  onCreateItem: (folderId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
}

// Stable handler bundle for memoized rows.
interface Handlers {
  onSelectItem: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveItemToFolder: (itemId: string, folderId: string | null) => void;
  onCreateItem: (folderId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onDropOnFolder: (event: DragEvent, folderId: string) => void;
  setDraggingKey: (key: string | null) => void;
  setDragOverKey: (key: string | null) => void;
}

interface ItemRowProps {
  item: ItemLite;
  depth: number;
  depthStep: number;
  basePad: number;
  selectedItemId: string | null;
  folderOptions: FolderLite[];
  inFolder: boolean;
  draggingKey: string | null;
  handlers: Handlers;
}

const ItemRow = memo(function ItemRow({
  item,
  depth,
  depthStep,
  basePad,
  selectedItemId,
  folderOptions,
  inFolder,
  draggingKey,
  handlers,
}: ItemRowProps) {
  const isSelected = item.id === selectedItemId;
  const title = item.title?.trim() || "Untitled";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={`#item-${item.id}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_ITEM, item.id);
            event.dataTransfer.effectAllowed = "move";
            const el = event.currentTarget;
            setTimeout(() => el.classList.add("opacity-40"), 0);
            handlers.setDraggingKey(`item:${item.id}`);
          }}
          onDragEnd={(event) => {
            event.currentTarget.classList.remove("opacity-40");
            handlers.setDraggingKey(null);
            handlers.setDragOverKey(null);
          }}
          onClick={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            handlers.onSelectItem(item.id);
          }}
          className={cn(
            "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-sm transition-colors hover:bg-accent/60 cursor-grab active:cursor-grabbing",
            isSelected && "bg-accent text-accent-foreground",
            draggingKey === `item:${item.id}` && "opacity-40",
          )}
          style={{ paddingLeft: `${basePad + depth * depthStep}px` }}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handlers.onToggleFavorite(item.id, !item.is_favorite);
            }}
            title={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
            className={cn(
              "shrink-0 text-muted-foreground transition-opacity hover:text-warning",
              item.is_favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Star
              className={cn("h-3.5 w-3.5", item.is_favorite && "fill-warning text-warning")}
            />
          </button>
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => handlers.onSelectItem(item.id)}>
          Open
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => handlers.onToggleFavorite(item.id, !item.is_favorite)}
        >
          <Star
            className={cn(
              "mr-2 h-3.5 w-3.5",
              item.is_favorite && "fill-warning text-warning",
            )}
          />
          {item.is_favorite ? "Unfavorite" : "Favorite"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Folder className="mr-2 h-3.5 w-3.5" /> Move to folder
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {folderOptions.length === 0 ? (
              <ContextMenuItem disabled>No folders yet</ContextMenuItem>
            ) : (
              folderOptions.map((folder) => (
                <ContextMenuItem
                  key={folder.id}
                  onClick={() => handlers.onMoveItemToFolder(item.id, folder.id)}
                >
                  {folder.name}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {inFolder && (
          <ContextMenuItem onClick={() => handlers.onMoveItemToFolder(item.id, null)}>
            Remove from folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => handlers.onDeleteItem(item.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface FolderRowProps {
  node: FolderTreeNode;
  depth: number;
  depthStep: number;
  basePad: number;
  expanded: Set<string>;
  selectedItemId: string | null;
  folderOptions: FolderLite[];
  draggingKey: string | null;
  dragOverKey: string | null;
  handlers: Handlers;
}

const FolderRow = memo(function FolderRow({
  node,
  depth,
  depthStep,
  basePad,
  expanded,
  selectedItemId,
  folderOptions,
  draggingKey,
  dragOverKey,
  handlers,
}: FolderRowProps) {
  const folder = node.folder;
  const key = `folder:${folder.id}`;
  const isOpen = expanded.has(key);
  const isDragOver = dragOverKey === folder.id && draggingKey !== key;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_FOLDER, folder.id);
              event.dataTransfer.effectAllowed = "move";
              const el = event.currentTarget;
              setTimeout(() => el.classList.add("opacity-40"), 0);
              handlers.setDraggingKey(key);
            }}
            onDragEnd={(event) => {
              event.currentTarget.classList.remove("opacity-40");
              handlers.setDraggingKey(null);
              handlers.setDragOverKey(null);
            }}
            onClick={() => handlers.onToggleFolder(folder.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragOverKey !== folder.id) handlers.setDragOverKey(folder.id);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && event.currentTarget.contains(next)) return;
              if (dragOverKey === folder.id) handlers.setDragOverKey(null);
            }}
            onDrop={(event) => handlers.onDropOnFolder(event, folder.id)}
            className={cn(
              "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60 cursor-grab active:cursor-grabbing",
              isDragOver && "ring-2 ring-primary ring-inset bg-primary/10",
              draggingKey === key && "opacity-40",
            )}
            style={{ paddingLeft: `${8 + depth * depthStep}px` }}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {node.subtreeCount}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => handlers.onCreateFolder(folder.id)}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New subfolder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.onCreateItem(folder.id)}>
            <Plus className="mr-2 h-3.5 w-3.5" /> New item here
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => handlers.onRenameFolder(folder.id, folder.name)}
          >
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => handlers.onDeleteFolder(folder.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isOpen && (
        <div>
          {node.children.map((child) => (
            <FolderRow
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              depthStep={depthStep}
              basePad={basePad}
              expanded={expanded}
              selectedItemId={selectedItemId}
              folderOptions={folderOptions}
              draggingKey={draggingKey}
              dragOverKey={dragOverKey}
              handlers={handlers}
            />
          ))}
          {node.items.map((item) => (
            <ItemRow
              key={`${key}:${item.id}`}
              item={item}
              depth={depth + 1}
              depthStep={depthStep}
              basePad={basePad}
              selectedItemId={selectedItemId}
              folderOptions={folderOptions}
              inFolder
              draggingKey={draggingKey}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface SectionRowProps {
  sectionKey: string;
  label: string;
  icon: typeof Star;
  items: ItemLite[];
  expanded: Set<string>;
  depthStep: number;
  basePad: number;
  selectedItemId: string | null;
  folderOptions: FolderLite[];
  draggingKey: string | null;
  onToggle: (key: string) => void;
  handlers: Handlers;
}

const SectionRow = memo(function SectionRow({
  sectionKey,
  label,
  icon: Icon,
  items,
  expanded,
  depthStep,
  basePad,
  selectedItemId,
  folderOptions,
  draggingKey,
  onToggle,
  handlers,
}: SectionRowProps) {
  const isOpen = expanded.has(sectionKey);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60"
        style={{ paddingLeft: "8px" }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] text-muted-foreground">{items.length}</span>
      </button>
      {isOpen && (
        <div>
          {items.length === 0 ? (
            <div
              className="text-[11px] italic text-muted-foreground"
              style={{
                paddingLeft: `${basePad + depthStep}px`,
                paddingTop: "2px",
                paddingBottom: "2px",
              }}
            >
              None
            </div>
          ) : (
            items.map((item) => (
              <ItemRow
                key={`${sectionKey}:${item.id}`}
                item={item}
                depth={1}
                depthStep={depthStep}
                basePad={basePad}
                selectedItemId={selectedItemId}
                folderOptions={folderOptions}
                inFolder={Boolean(item.folder_id)}
                draggingKey={draggingKey}
                handlers={handlers}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

export function CollectionItemsTree({
  items,
  folders,
  selectedItemId,
  searchQuery,
  onSelectItem,
  onToggleFavorite,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReparentFolder,
  onMoveItemToFolder,
  onCreateItem,
  onDeleteItem,
}: CollectionItemsTreeProps) {
  const depthStep = 12;
  const basePad = 8;

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([FAVORITES_KEY, RECENT_KEY, ALL_KEY, SEARCH_KEY]),
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const tree = useMemo(
    () => buildCollectionItemsTree({ items, folders }),
    [items, folders],
  );

  const folderOptions = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  const favorites = useMemo(
    () =>
      items
        .filter((i) => i.is_favorite)
        .slice()
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    [items],
  );

  const recent = useMemo(
    () =>
      items
        .filter((i) => i.last_viewed_at)
        .slice()
        .sort(
          (a, b) =>
            new Date(b.last_viewed_at!).getTime() -
            new Date(a.last_viewed_at!).getTime(),
        )
        .slice(0, 15),
    [items],
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => (i.title ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }, [items, searchQuery]);

  const searching = searchQuery.trim().length > 0;

  // Auto-expand ancestors of the selected item so its row is reachable.
  useEffect(() => {
    if (!selectedItemId) return;
    const selected = items.find((i) => i.id === selectedItemId);
    if (!selected) return;
    const parentByFolder = new Map(
      folders.map((f) => [f.id, f.parent_folder_id] as const),
    );
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(ALL_KEY);
      let cur: string | null | undefined = selected.folder_id ?? null;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        next.add(`folder:${cur}`);
        cur = parentByFolder.get(cur) ?? null;
      }
      return next;
    });
  }, [selectedItemId, items, folders]);

  const toggleSection = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleFolder = useCallback((folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const key = `folder:${folderId}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleDropOnFolder = useCallback(
    (event: DragEvent, folderId: string) => {
      event.preventDefault();
      setDragOverKey(null);
      const itemId = event.dataTransfer.getData(DRAG_ITEM);
      if (itemId) {
        onMoveItemToFolder(itemId, folderId);
        return;
      }
      const draggedFolderId = event.dataTransfer.getData(DRAG_FOLDER);
      if (draggedFolderId && draggedFolderId !== folderId) {
        if (wouldCreateFolderCycle(folders, draggedFolderId, folderId)) return;
        onReparentFolder(draggedFolderId, folderId);
      }
    },
    [folders, onMoveItemToFolder, onReparentFolder],
  );

  const handleDropOnRoot = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragOverKey(null);
      const itemId = event.dataTransfer.getData(DRAG_ITEM);
      if (itemId) {
        onMoveItemToFolder(itemId, null);
        return;
      }
      const draggedFolderId = event.dataTransfer.getData(DRAG_FOLDER);
      if (draggedFolderId) onReparentFolder(draggedFolderId, null);
    },
    [onMoveItemToFolder, onReparentFolder],
  );

  const handlers: Handlers = useMemo(
    () => ({
      onSelectItem,
      onToggleFavorite,
      onCreateFolder,
      onRenameFolder,
      onDeleteFolder,
      onMoveItemToFolder,
      onCreateItem,
      onDeleteItem,
      onToggleFolder: handleToggleFolder,
      onDropOnFolder: handleDropOnFolder,
      setDraggingKey,
      setDragOverKey,
    }),
    [
      onSelectItem,
      onToggleFavorite,
      onCreateFolder,
      onRenameFolder,
      onDeleteFolder,
      onMoveItemToFolder,
      onCreateItem,
      onDeleteItem,
      handleToggleFolder,
      handleDropOnFolder,
    ],
  );

  if (searching) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <SectionRow
          sectionKey={SEARCH_KEY}
          label={`Search results (${searchResults.length})`}
          icon={Folder}
          items={searchResults}
          expanded={new Set([SEARCH_KEY])}
          depthStep={depthStep}
          basePad={basePad}
          selectedItemId={selectedItemId}
          folderOptions={folderOptions}
          draggingKey={draggingKey}
          onToggle={() => undefined}
          handlers={handlers}
        />
      </div>
    );
  }

  const allOpen = expanded.has(ALL_KEY);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      <SectionRow
        sectionKey={FAVORITES_KEY}
        label="Favorites"
        icon={Star}
        items={favorites}
        expanded={expanded}
        depthStep={depthStep}
        basePad={basePad}
        selectedItemId={selectedItemId}
        folderOptions={folderOptions}
        draggingKey={draggingKey}
        onToggle={toggleSection}
        handlers={handlers}
      />
      <SectionRow
        sectionKey={RECENT_KEY}
        label="Recent"
        icon={Clock}
        items={recent}
        expanded={expanded}
        depthStep={depthStep}
        basePad={basePad}
        selectedItemId={selectedItemId}
        folderOptions={folderOptions}
        draggingKey={draggingKey}
        onToggle={toggleSection}
        handlers={handlers}
      />

      {/* All items — folders first, then loose items at depth 1. */}
      <div>
        <button
          type="button"
          onClick={() => toggleSection(ALL_KEY)}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (dragOverKey !== ALL_KEY) setDragOverKey(ALL_KEY);
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            if (dragOverKey === ALL_KEY) setDragOverKey(null);
          }}
          onDrop={handleDropOnRoot}
          className={cn(
            "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60",
            dragOverKey === ALL_KEY && "ring-2 ring-primary ring-inset bg-primary/10",
          )}
          style={{ paddingLeft: "8px" }}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
            {allOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">All items</span>
          <span className="text-[10px] text-muted-foreground">{items.length}</span>
        </button>
        {allOpen && (
          <div>
            {tree.roots.map((child) => (
              <FolderRow
                key={child.folder.id}
                node={child}
                depth={1}
                depthStep={depthStep}
                basePad={basePad}
                expanded={expanded}
                selectedItemId={selectedItemId}
                folderOptions={folderOptions}
                draggingKey={draggingKey}
                dragOverKey={dragOverKey}
                handlers={handlers}
              />
            ))}
            {tree.looseItems.map((item) => (
              <ItemRow
                key={`root:${item.id}`}
                item={item}
                depth={1}
                depthStep={depthStep}
                basePad={basePad}
                selectedItemId={selectedItemId}
                folderOptions={folderOptions}
                inFolder={false}
                draggingKey={draggingKey}
                handlers={handlers}
              />
            ))}
            {tree.roots.length === 0 && tree.looseItems.length === 0 && (
              <div
                className="text-[11px] italic text-muted-foreground"
                style={{
                  paddingLeft: `${basePad + depthStep}px`,
                  paddingTop: "2px",
                  paddingBottom: "2px",
                }}
              >
                No items yet
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 px-2">
        <button
          type="button"
          onClick={() => onCreateFolder(null)}
          className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New folder
        </button>
      </div>
    </div>
  );
}
