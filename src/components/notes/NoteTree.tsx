import { type DragEvent, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Pin,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { Note, SemanticSearchResult } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import { showToast } from "@/lib/toast";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelect } from "./useBulkSelect";
import { BulkActionBar } from "./BulkActionBar";

export type NoteTreeSortField = "updated_at" | "created_at" | "title";
export type NoteTreeSortDirection = "asc" | "desc";

interface NoteTreeProps {
  notes: (Note | SemanticSearchResult)[];
  folderPaths: string[];
  selectedId: string | null;
  activeFolderPath: string | null;
  onSelectNote: (id: string) => void;
  onSelectFolder: (path: string | null) => void;
  onCreateNoteInFolder: (path: string) => void;
  onCreateFolderInFolder: (path: string) => void;
  onMoveNote: (noteId: string, path: string) => void;
  onRenameFolder?: (path: string) => void;
  onMoveFolder?: (sourcePath: string, targetParentPath: string) => void;
  onDeleteFolder?: (path: string) => void;
  onRestoreNote?: (noteId: string) => void;
  onDeleteNotePermanently?: (noteId: string) => void;
  sortField?: NoteTreeSortField;
  sortDirection?: NoteTreeSortDirection;
}

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: (Note | SemanticSearchResult)[];
}

const normalizePath = (path: string | null | undefined) =>
  (path || "").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();

function ensureFolder(root: FolderNode, path: string) {
  if (!path) return root;
  let cursor = root;
  const parts = path.split("/").filter(Boolean);
  parts.forEach((part, index) => {
    const nextPath = parts.slice(0, index + 1).join("/");
    let child = cursor.children.find((node) => node.path === nextPath);
    if (!child) {
      child = { name: part, path: nextPath, children: [], notes: [] };
      cursor.children.push(child);
    }
    cursor = child;
  });
  return cursor;
}

function sortFolder(
  node: FolderNode,
  sortField: NoteTreeSortField,
  sortDirection: NoteTreeSortDirection,
) {
  // Folder names always alphabetical — sorting them by date doesn't apply.
  node.children.sort((a, b) => a.name.localeCompare(b.name));

  const dir = sortDirection === "asc" ? 1 : -1;
  node.notes.sort((a, b) => {
    const aPinned = a.is_pinned ? 1 : 0;
    const bPinned = b.is_pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned; // pinned always first

    if (sortField === "title") {
      return dir * (a.title || "Untitled").localeCompare(b.title || "Untitled");
    }
    const aRaw = (a as unknown as Record<string, unknown>)[sortField];
    const bRaw = (b as unknown as Record<string, unknown>)[sortField];
    const aTs = typeof aRaw === "string" ? new Date(aRaw).getTime() : 0;
    const bTs = typeof bRaw === "string" ? new Date(bRaw).getTime() : 0;
    return dir * (aTs - bTs);
  });

  node.children.forEach((child) => sortFolder(child, sortField, sortDirection));
}

function countNestedNotes(node: FolderNode): number {
  return node.notes.length + node.children.reduce((sum, child) => sum + countNestedNotes(child), 0);
}

function collectAncestorPaths(path: string | null) {
  if (!path) return [];
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function NoteTree({
  notes,
  folderPaths,
  selectedId,
  activeFolderPath,
  onSelectNote,
  onSelectFolder,
  onCreateNoteInFolder,
  onCreateFolderInFolder,
  onMoveNote,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRestoreNote,
  onDeleteNotePermanently,
  sortField = "updated_at",
  sortDirection = "desc",
}: NoteTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["__root__"]));
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const tree = useMemo(() => {
    const root: FolderNode = { name: "Vault root", path: "", children: [], notes: [] };
    const allFolderPaths = new Set<string>();

    folderPaths.forEach((path) => {
      const normalized = normalizePath(path);
      if (!normalized) return;
      const parts = normalized.split("/");
      parts.forEach((_, index) => allFolderPaths.add(parts.slice(0, index + 1).join("/")));
    });

    notes.forEach((note) => {
      const normalized = normalizePath(note.folder_path);
      if (normalized) {
        const parts = normalized.split("/");
        parts.forEach((_, index) => allFolderPaths.add(parts.slice(0, index + 1).join("/")));
      }
    });

    allFolderPaths.forEach((path) => ensureFolder(root, path));
    notes.forEach((note) => ensureFolder(root, normalizePath(note.folder_path)).notes.push(note));
    sortFolder(root, sortField, sortDirection);
    return root;
  }, [folderPaths, notes, sortField, sortDirection]);

  // Flat list of visible note ids (DFS, respecting expanded folders) — used
  // for shift+click range selection.
  const visibleNoteIds = useMemo(() => {
    const out: string[] = [];
    const walk = (node: FolderNode) => {
      const key = node.path || "__root__";
      if (!expanded.has(key)) return;
      node.children.forEach(walk);
      node.notes.forEach((n) => out.push(n.id));
    };
    walk(tree);
    return out;
  }, [tree, expanded]);

  const bulk = useBulkSelect(visibleNoteIds);
  const multiActive = bulk.size > 0;
  const selectedIds = useMemo(() => Array.from(bulk.selected), [bulk.selected]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      next.add("__root__");
      collectAncestorPaths(activeFolderPath).forEach((path) => next.add(path));
      const selected = notes.find((note) => note.id === selectedId);
      collectAncestorPaths(normalizePath(selected?.folder_path)).forEach((path) => next.add(path));
      return next;
    });
  }, [activeFolderPath, notes, selectedId]);

  const toggleFolder = (path: string) => {
    const key = path || "__root__";
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDrop = (path: string, event: DragEvent) => {
    event.preventDefault();
    setDragOverPath(null);
    const folderPath = event.dataTransfer.getData("application/x-folder-path");
    if (folderPath) {
      if (onMoveFolder) onMoveFolder(folderPath, path);
      return;
    }
    const noteId = event.dataTransfer.getData("text/plain");
    if (noteId) onMoveNote(noteId, path);
  };

  const renderMoveTargets = (nodes: FolderNode[], noteId: string) =>
    nodes.map((node) => (
      <ContextMenuItem key={node.path} onClick={() => onMoveNote(noteId, node.path)}>
        <Folder className="mr-2 h-3.5 w-3.5" />
        {node.path}
      </ContextMenuItem>
    ));

  const FolderRow = ({ node, depth }: { node: FolderNode; depth: number }) => {
    const key = node.path || "__root__";
    const isOpen = expanded.has(key);
    const isActive = activeFolderPath === (node.path || "");
    const isRoot = !node.path;
    const count = countNestedNotes(node);
    const moveTargets = tree.children
      .flatMap((c) => flattenFolders(c))
      .filter((n) => n.path !== node.path && !n.path.startsWith(node.path + "/"));

    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              draggable={!isRoot}
              onDragStart={(event) => {
                if (isRoot) return;
                event.dataTransfer.setData("application/x-folder-path", node.path);
                event.dataTransfer.effectAllowed = "move";
                const el = event.currentTarget;
                // Defer so the browser captures the drag ghost first, then dim source
                setTimeout(() => el.classList.add("opacity-40"), 0);
                setDraggingKey(`folder:${node.path}`);
              }}
              onDragEnd={(event) => {
                event.currentTarget.classList.remove("opacity-40");
                setDraggingKey(null);
                setDragOverPath(null);
              }}
              onClick={() => {
                onSelectFolder(node.path);
                if (!isOpen) toggleFolder(node.path);
              }}
              onDoubleClick={() => toggleFolder(node.path)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragOverPath !== node.path) setDragOverPath(node.path);
              }}
              onDragLeave={(event) => {
                // Ignore leave events when moving onto descendants
                const next = event.relatedTarget as Node | null;
                if (next && event.currentTarget.contains(next)) return;
                setDragOverPath((current) => (current === node.path ? null : current));
              }}
              onDrop={(event) => handleDrop(node.path, event)}
              className={cn(
                "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60",
                !isRoot && "cursor-grab active:cursor-grabbing",
                isActive && "bg-accent text-accent-foreground",
                dragOverPath === node.path && draggingKey !== `folder:${node.path}` && "ring-2 ring-primary ring-inset bg-primary/10",
                draggingKey === `folder:${node.path}` && "opacity-40"
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolder(node.path);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </span>
              {isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{isRoot ? "Vault root" : node.name}</span>
              <span className="text-[10px] text-muted-foreground">{count}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={() => onCreateNoteInFolder(node.path)}>
              <FilePlus className="mr-2 h-3.5 w-3.5" /> New note here
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCreateFolderInFolder(node.path)}>
              <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder here
            </ContextMenuItem>
            {!isRoot && (onRenameFolder || onMoveFolder || onDeleteFolder) && (
              <ContextMenuSeparator />
            )}
            {!isRoot && onRenameFolder && (
              <ContextMenuItem onClick={() => onRenameFolder(node.path)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Rename folder…
              </ContextMenuItem>
            )}
            {!isRoot && onMoveFolder && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Folder className="mr-2 h-3.5 w-3.5" /> Move to
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                  <ContextMenuItem onClick={() => onMoveFolder(node.path, "")}>
                    <Folder className="mr-2 h-3.5 w-3.5" /> Vault root
                  </ContextMenuItem>
                  {moveTargets.length > 0 && <ContextMenuSeparator />}
                  {moveTargets.map((t) => (
                    <ContextMenuItem key={t.path} onClick={() => onMoveFolder(node.path, t.path)}>
                      <Folder className="mr-2 h-3.5 w-3.5" /> {t.path}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {!isRoot && onDeleteFolder && (
              <ContextMenuItem
                onClick={() => onDeleteFolder(node.path)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete folder…
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {isOpen && (
          <div>
            {node.children.map((child) => <FolderRow key={child.path} node={child} depth={depth + 1} />)}
            {node.notes.map((note) => <NoteRow key={note.id} note={note} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  };

  const NoteRow = ({ note, depth }: { note: Note | SemanticSearchResult; depth: number }) => {
    const folderOptions = tree.children.flatMap((node) => flattenFolders(node));
    const isMultiSelected = bulk.isSelected(note.id);
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a
            href={`/dashboard/notes/${note.id}`}
            draggable={!note.is_external && !multiActive}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", note.id);
              event.dataTransfer.effectAllowed = "move";
              const el = event.currentTarget;
              setTimeout(() => el.classList.add("opacity-40"), 0);
              setDraggingKey(`note:${note.id}`);
            }}
            onDragEnd={(event) => {
              event.currentTarget.classList.remove("opacity-40");
              setDraggingKey(null);
              setDragOverPath(null);
            }}
            onClick={(event) => {
              const consumed = bulk.handleClick(event, note.id);
              if (consumed) return;
              if (event.button === 0) {
                event.preventDefault();
                onSelectFolder(normalizePath(note.folder_path));
                onSelectNote(note.id);
              }
            }}
            className={cn(
              "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-sm transition-colors hover:bg-accent/60",
              !note.is_external && !multiActive && "cursor-grab active:cursor-grabbing",
              selectedId === note.id && !multiActive && "bg-accent text-accent-foreground",
              isMultiSelected && "bg-primary/10 hover:bg-primary/15",
              draggingKey === `note:${note.id}` && "opacity-40"
            )}
            style={{ paddingLeft: `${14 + depth * 14}px` }}
          >
            {multiActive && (
              <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isMultiSelected}
                  onCheckedChange={() =>
                    bulk.handleClick(
                      { metaKey: true, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent,
                      note.id,
                    )
                  }
                  aria-label="Select note"
                  className="h-3.5 w-3.5"
                />
              </span>
            )}
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
            <span className="hidden text-[10px] text-muted-foreground group-hover:inline">
              {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
            </span>
            {note.is_pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
            {note.is_favorite && <Star className="h-3 w-3 shrink-0 fill-warning text-warning" />}
            {note.is_trashed && <Trash2 className="h-3 w-3 shrink-0 text-destructive" />}
          </a>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/dashboard/notes/${note.id}`);
              showToast.copied();
            }}
          >
            <Link2 className="mr-2 h-3.5 w-3.5" /> Copy link
          </ContextMenuItem>
          <ContextMenuSeparator />
          {note.is_trashed ? (
            <>
              {onRestoreNote && (
                <ContextMenuItem onClick={() => onRestoreNote(note.id)}>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore note
                </ContextMenuItem>
              )}
              {onDeleteNotePermanently && (
                <ContextMenuItem
                  onClick={() => onDeleteNotePermanently(note.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete permanently…
                </ContextMenuItem>
              )}
            </>
          ) : (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                <ContextMenuItem onClick={() => onMoveNote(note.id, "")}>
                  <Folder className="mr-2 h-3.5 w-3.5" /> Vault root
                </ContextMenuItem>
                {folderOptions.length > 0 && <ContextMenuSeparator />}
                {renderMoveTargets(folderOptions, note.id)}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  if (notes.length === 0 && folderPaths.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No notes yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-2">
        <FolderRow node={tree} depth={0} />
      </div>
      {multiActive && (
        <BulkActionBar selectedIds={selectedIds} notes={notes} onClear={bulk.clear} />
      )}
    </div>
  );
}

function flattenFolders(node: FolderNode): FolderNode[] {
  return [node, ...node.children.flatMap(flattenFolders)];
}
