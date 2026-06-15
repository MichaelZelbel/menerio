import { memo, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
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

import { Note, SemanticSearchResult, useDuplicateNote } from "@/hooks/useNotes";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { useBulkSelect, type UseBulkSelectResult } from "./useBulkSelect";
import { BulkActionBar } from "./BulkActionBar";
import { CaptureEmptyState } from "./CaptureEmptyState";

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
  favoriteNotes?: Note[];
  trashedNotes?: Note[];
}


interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: (Note | SemanticSearchResult)[];
  noteCount: number;
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
      child = { name: part, path: nextPath, children: [], notes: [], noteCount: 0 };
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
  node.children.sort((a, b) => a.name.localeCompare(b.name));

  const dir = sortDirection === "asc" ? 1 : -1;
  node.notes.sort((a, b) => {
    const aPinned = a.is_pinned ? 1 : 0;
    const bPinned = b.is_pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    if (sortField === "title") {
      return dir * (a.title || "Untitled").localeCompare(b.title || "Untitled");
    }
    const aRaw = (a as unknown as Record<string, unknown>)[sortField];
    const bRaw = (b as unknown as Record<string, unknown>)[sortField];
    const aTs = typeof aRaw === "string" ? new Date(aRaw).getTime() : 0;
    const bTs = typeof bRaw === "string" ? new Date(bRaw).getTime() : 0;
    return dir * (aTs - bTs);
  });

  let nestedCount = node.notes.length;
  node.children.forEach((child) => {
    sortFolder(child, sortField, sortDirection);
    nestedCount += child.noteCount;
  });
  node.noteCount = nestedCount;
}

function collectAncestorPaths(path: string | null) {
  if (!path) return [];
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function flattenFolders(node: FolderNode): FolderNode[] {
  return [node, ...node.children.flatMap(flattenFolders)];
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  activeFolderPath: string | null;
  dragOverPath: string | null;
  draggingKey: string | null;
  depthStep: number;
  noteBasePad: number;
  folderOptions: FolderNode[];
  selectedId: string | null;
  multiActive: boolean;
  selectedIds: string[];
  bulk: UseBulkSelectResult;
  onToggleFolder: (path: string) => void;
  onSelectFolder: (path: string | null) => void;
  onSelectNote: (id: string) => void;
  onCreateNoteInFolder: (path: string) => void;
  onCreateFolderInFolder: (path: string) => void;
  onMoveNote: (noteId: string, path: string) => void;
  onRenameFolder?: (path: string) => void;
  onMoveFolder?: (sourcePath: string, targetParentPath: string) => void;
  onDeleteFolder?: (path: string) => void;
  onRestoreNote?: (noteId: string) => void;
  onDeleteNotePermanently?: (noteId: string) => void;
  onDrop: (path: string, event: DragEvent) => void;
  onDuplicateNote: (note: Note | SemanticSearchResult) => Promise<void>;
  setDragOverPath: Dispatch<SetStateAction<string | null>>;
  setDraggingKey: Dispatch<SetStateAction<string | null>>;
}

const FolderRow = memo(function FolderRow({
  node,
  depth,
  expanded,
  activeFolderPath,
  dragOverPath,
  draggingKey,
  depthStep,
  noteBasePad,
  folderOptions,
  selectedId,
  multiActive,
  selectedIds,
  bulk,
  onToggleFolder,
  onSelectFolder,
  onSelectNote,
  onCreateNoteInFolder,
  onCreateFolderInFolder,
  onMoveNote,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRestoreNote,
  onDeleteNotePermanently,
  onDrop,
  onDuplicateNote,
  setDragOverPath,
  setDraggingKey,
}: FolderRowProps) {
  const key = node.path || "__root__";
  const isOpen = expanded.has(key);
  const isActive = activeFolderPath === (node.path || "");
  const isRoot = !node.path;
  const moveTargets = folderOptions.filter((n) => n.path !== node.path && !n.path.startsWith(node.path + "/"));

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
              if (!isOpen) onToggleFolder(node.path);
            }}
            onDoubleClick={() => onToggleFolder(node.path)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragOverPath !== node.path) setDragOverPath(node.path);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && event.currentTarget.contains(next)) return;
              setDragOverPath((current) => (current === node.path ? null : current));
            }}
            onDrop={(event) => onDrop(node.path, event)}
            className={cn(
              "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60",
              !isRoot && "cursor-grab active:cursor-grabbing",
              isActive && "bg-accent text-accent-foreground",
              dragOverPath === node.path && draggingKey !== `folder:${node.path}` && "ring-2 ring-primary ring-inset bg-primary/10",
              draggingKey === `folder:${node.path}` && "opacity-40"
            )}
            style={{ paddingLeft: `${8 + depth * depthStep}px` }}
          >
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFolder(node.path);
              }}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            {isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{isRoot ? "Vault root" : node.name}</span>
            <span className="text-[10px] text-muted-foreground">{node.noteCount}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => onCreateNoteInFolder(node.path)}>
            <FilePlus className="mr-2 h-3.5 w-3.5" /> New note here
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCreateFolderInFolder(node.path)}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder here
          </ContextMenuItem>
          {!isRoot && (onRenameFolder || onMoveFolder || onDeleteFolder) && <ContextMenuSeparator />}
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
          {node.children.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activeFolderPath={activeFolderPath}
              dragOverPath={dragOverPath}
              draggingKey={draggingKey}
              depthStep={depthStep}
              noteBasePad={noteBasePad}
              folderOptions={folderOptions}
              selectedId={selectedId}
              multiActive={multiActive}
              selectedIds={selectedIds}
              bulk={bulk}
              onToggleFolder={onToggleFolder}
              onSelectFolder={onSelectFolder}
              onSelectNote={onSelectNote}
              onCreateNoteInFolder={onCreateNoteInFolder}
              onCreateFolderInFolder={onCreateFolderInFolder}
              onMoveNote={onMoveNote}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
              onRestoreNote={onRestoreNote}
              onDeleteNotePermanently={onDeleteNotePermanently}
              onDrop={onDrop}
              onDuplicateNote={onDuplicateNote}
              setDragOverPath={setDragOverPath}
              setDraggingKey={setDraggingKey}
            />
          ))}
          {node.notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              depth={depth + 1}
              noteBasePad={noteBasePad}
              depthStep={depthStep}
              folderOptions={folderOptions}
              selectedId={selectedId}
              multiActive={multiActive}
              selectedIds={selectedIds}
              bulk={bulk}
              draggingKey={draggingKey}
              onSelectFolder={onSelectFolder}
              onSelectNote={onSelectNote}
              onMoveNote={onMoveNote}
              onRestoreNote={onRestoreNote}
              onDeleteNotePermanently={onDeleteNotePermanently}
              onDuplicateNote={onDuplicateNote}
              setDragOverPath={setDragOverPath}
              setDraggingKey={setDraggingKey}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface NoteRowProps {
  note: Note | SemanticSearchResult;
  depth: number;
  noteBasePad: number;
  depthStep: number;
  folderOptions: FolderNode[];
  selectedId: string | null;
  multiActive: boolean;
  selectedIds: string[];
  bulk: UseBulkSelectResult;
  draggingKey: string | null;
  onSelectFolder: (path: string | null) => void;
  onSelectNote: (id: string) => void;
  onMoveNote: (noteId: string, path: string) => void;
  onRestoreNote?: (noteId: string) => void;
  onDeleteNotePermanently?: (noteId: string) => void;
  onDuplicateNote: (note: Note | SemanticSearchResult) => Promise<void>;
  setDragOverPath: Dispatch<SetStateAction<string | null>>;
  setDraggingKey: Dispatch<SetStateAction<string | null>>;
}

const NoteRow = memo(function NoteRow({
  note,
  depth,
  noteBasePad,
  depthStep,
  folderOptions,
  selectedId,
  multiActive,
  selectedIds,
  bulk,
  draggingKey,
  onSelectFolder,
  onSelectNote,
  onMoveNote,
  onRestoreNote,
  onDeleteNotePermanently,
  onDuplicateNote,
  setDragOverPath,
  setDraggingKey,
}: NoteRowProps) {
  const isMultiSelected = bulk.isSelected(note.id);
  const canDrag = !multiActive || isMultiSelected;
  const applyMove = (path: string) => {
    if (multiActive && isMultiSelected && selectedIds.length > 1) {
      selectedIds.forEach((id) => onMoveNote(id, path));
      bulk.clear();
    } else {
      onMoveNote(note.id, path);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={`/dashboard/notes/${note.id}`}
          draggable={canDrag}
          onDragStart={(event) => {
            if (multiActive && isMultiSelected && selectedIds.length > 1) {
              event.dataTransfer.setData("application/x-note-ids", JSON.stringify(selectedIds));
            }
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
            canDrag && "cursor-grab active:cursor-grabbing",
            selectedId === note.id && !multiActive && "bg-accent text-accent-foreground",
            isMultiSelected && "bg-primary/10 hover:bg-primary/15",
            draggingKey === `note:${note.id}` && "opacity-40"
          )}
          style={{ paddingLeft: `${noteBasePad + depth * depthStep}px` }}
        >
          {multiActive && (
            <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isMultiSelected}
                onCheckedChange={() =>
                  bulk.handleClick(
                    { metaKey: true, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent,
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
        {!note.is_trashed && (
          <ContextMenuItem onClick={() => onDuplicateNote(note)}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Make a copy
          </ContextMenuItem>
        )}
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
            <ContextMenuSubTrigger>
              {multiActive && isMultiSelected && selectedIds.length > 1
                ? `Move ${selectedIds.length} notes to`
                : "Move to"}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <ContextMenuItem onClick={() => applyMove("")}>
                <Folder className="mr-2 h-3.5 w-3.5" /> Vault root
              </ContextMenuItem>
              {folderOptions.length > 0 && <ContextMenuSeparator />}
              {folderOptions.map((node) => (
                <ContextMenuItem key={node.path} onClick={() => applyMove(node.path)}>
                  <Folder className="mr-2 h-3.5 w-3.5" />
                  {node.path}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface VirtualRootRowProps {
  rootKey: string;
  label: string;
  icon: typeof Star;
  notes: (Note | SemanticSearchResult)[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  depthStep: number;
  noteBasePad: number;
  folderOptions: FolderNode[];
  selectedId: string | null;
  multiActive: boolean;
  selectedIds: string[];
  bulk: UseBulkSelectResult;
  draggingKey: string | null;
  onSelectFolder: (path: string | null) => void;
  onSelectNote: (id: string) => void;
  onMoveNote: (noteId: string, path: string) => void;
  onRestoreNote?: (noteId: string) => void;
  onDeleteNotePermanently?: (noteId: string) => void;
  onDuplicateNote: (note: Note | SemanticSearchResult) => Promise<void>;
  setDragOverPath: Dispatch<SetStateAction<string | null>>;
  setDraggingKey: Dispatch<SetStateAction<string | null>>;
}

const VirtualRootRow = memo(function VirtualRootRow({
  rootKey,
  label,
  icon: Icon,
  notes,
  expanded,
  onToggle,
  depthStep,
  noteBasePad,
  folderOptions,
  selectedId,
  multiActive,
  selectedIds,
  bulk,
  draggingKey,
  onSelectFolder,
  onSelectNote,
  onMoveNote,
  onRestoreNote,
  onDeleteNotePermanently,
  onDuplicateNote,
  setDragOverPath,
  setDraggingKey,
}: VirtualRootRowProps) {
  const isOpen = expanded.has(rootKey);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(rootKey)}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60"
        style={{ paddingLeft: "8px" }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] text-muted-foreground">{notes.length}</span>
      </button>
      {isOpen && (
        <div>
          {notes.length === 0 ? (
            <div
              className="text-[11px] text-muted-foreground italic"
              style={{ paddingLeft: `${noteBasePad + depthStep}px`, paddingTop: "2px", paddingBottom: "2px" }}
            >
              No notes
            </div>
          ) : (
            notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                depth={1}
                noteBasePad={noteBasePad}
                depthStep={depthStep}
                folderOptions={folderOptions}
                selectedId={selectedId}
                multiActive={multiActive}
                selectedIds={selectedIds}
                bulk={bulk}
                draggingKey={draggingKey}
                onSelectFolder={onSelectFolder}
                onSelectNote={onSelectNote}
                onMoveNote={onMoveNote}
                onRestoreNote={onRestoreNote}
                onDeleteNotePermanently={onDeleteNotePermanently}
                onDuplicateNote={onDuplicateNote}
                setDragOverPath={setDragOverPath}
                setDraggingKey={setDraggingKey}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

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
  favoriteNotes,
  trashedNotes,
}: NoteTreeProps) {

  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const duplicateNote = useDuplicateNote();
  const depthStep = isMobile ? 8 : 14;
  const noteBasePad = isMobile ? 8 : 14;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["__root__"]));
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const tree = useMemo(() => {
    const root: FolderNode = { name: "Vault root", path: "", children: [], notes: [], noteCount: 0 };
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

  const folderOptions = useMemo(() => tree.children.flatMap(flattenFolders), [tree]);

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
  const selectedFolderPath = useMemo(() => {
    const selected = notes.find((note) => note.id === selectedId);
    return normalizePath(selected?.folder_path);
  }, [notes, selectedId]);

  const favoritesList = useMemo(() => {
    const list = favoriteNotes ?? notes.filter((n) => "is_favorite" in n && n.is_favorite);
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortField === "title") return dir * (a.title || "Untitled").localeCompare(b.title || "Untitled");
      const aRaw = (a as unknown as Record<string, unknown>)[sortField];
      const bRaw = (b as unknown as Record<string, unknown>)[sortField];
      const aTs = typeof aRaw === "string" ? new Date(aRaw).getTime() : 0;
      const bTs = typeof bRaw === "string" ? new Date(bRaw).getTime() : 0;
      return dir * (aTs - bTs);
    });
  }, [favoriteNotes, notes, sortField, sortDirection]);

  const recentList = useMemo(() => {
    return [...notes]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 20);
  }, [notes]);

  const trashList = useMemo(() => {
    const list = trashedNotes ?? [];
    return [...list].sort((a, b) => {
      const aTs = new Date((a.trashed_at as string | null) ?? a.updated_at).getTime();
      const bTs = new Date((b.trashed_at as string | null) ?? b.updated_at).getTime();
      return bTs - aTs;
    });
  }, [trashedNotes]);

  // Auto-expand virtual roots when the selected note belongs there
  useEffect(() => {
    if (!selectedId) return;
    const inTrash = (trashedNotes ?? []).some((n) => n.id === selectedId);
    const inFavorites =
      !inTrash &&
      (favoriteNotes ?? []).some((n) => n.id === selectedId) &&
      !notes.some((n) => n.id === selectedId);
    if (!inTrash && !inFavorites) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (inTrash) next.add("__trash__");
      if (inFavorites) next.add("__favorites__");
      return next;
    });
  }, [selectedId, trashedNotes, favoriteNotes, notes]);

  useEffect(() => {
    const requiredKeys = new Set<string>(["__root__"]);
    collectAncestorPaths(activeFolderPath).forEach((path) => requiredKeys.add(path));
    collectAncestorPaths(selectedFolderPath).forEach((path) => requiredKeys.add(path));

    setExpanded((current) => {
      let changed = false;
      const next = new Set(current);
      requiredKeys.forEach((key) => {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [activeFolderPath, selectedFolderPath]);

  const toggleFolder = useCallback((path: string) => {
    const key = path || "__root__";
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleVirtualRoot = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);


  const handleDrop = useCallback((path: string, event: DragEvent) => {
    event.preventDefault();
    setDragOverPath(null);
    const folderPath = event.dataTransfer.getData("application/x-folder-path");
    if (folderPath) {
      if (onMoveFolder) onMoveFolder(folderPath, path);
      return;
    }
    const idsPayload = event.dataTransfer.getData("application/x-note-ids");
    if (idsPayload) {
      try {
        const ids = JSON.parse(idsPayload) as string[];
        if (Array.isArray(ids) && ids.length > 0) {
          ids.forEach((id) => onMoveNote(id, path));
          bulk.clear();
          return;
        }
      } catch {
        // fall through to single id
      }
    }
    const noteId = event.dataTransfer.getData("text/plain");
    if (noteId) onMoveNote(noteId, path);
  }, [bulk, onMoveFolder, onMoveNote]);

  const handleDuplicateNote = useCallback(async (note: Note | SemanticSearchResult) => {
    try {
      const created = await duplicateNote.mutateAsync(note.id);
      onSelectFolder(normalizePath(created.folder_path));
      onSelectNote(created.id);
      navigate(`/dashboard/notes/${created.id}`);
    } catch {
      /* handled by hook */
    }
  }, [duplicateNote, navigate, onSelectFolder, onSelectNote]);

  if (notes.length === 0 && folderPaths.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <CaptureEmptyState onCreateNote={() => onCreateNoteInFolder("")} variant="compact" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-2">
        {[
          { key: "__favorites__", label: "Favorites", icon: Star, items: favoritesList },
          { key: "__recent__", label: "Recent", icon: Clock, items: recentList },
        ].map((root) => (
          <VirtualRootRow
            key={root.key}
            rootKey={root.key}
            label={root.label}
            icon={root.icon}
            notes={root.items}
            expanded={expanded}
            onToggle={toggleVirtualRoot}
            depthStep={depthStep}
            noteBasePad={noteBasePad}
            folderOptions={folderOptions}
            selectedId={selectedId}
            multiActive={multiActive}
            selectedIds={selectedIds}
            bulk={bulk}
            draggingKey={draggingKey}
            onSelectFolder={onSelectFolder}
            onSelectNote={onSelectNote}
            onMoveNote={onMoveNote}
            onRestoreNote={onRestoreNote}
            onDeleteNotePermanently={onDeleteNotePermanently}
            onDuplicateNote={handleDuplicateNote}
            setDragOverPath={setDragOverPath}
            setDraggingKey={setDraggingKey}
          />
        ))}
        <FolderRow
          node={tree}
          depth={0}
          expanded={expanded}
          activeFolderPath={activeFolderPath}
          dragOverPath={dragOverPath}
          draggingKey={draggingKey}
          depthStep={depthStep}
          noteBasePad={noteBasePad}
          folderOptions={folderOptions}
          selectedId={selectedId}
          multiActive={multiActive}
          selectedIds={selectedIds}
          bulk={bulk}
          onToggleFolder={toggleFolder}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onCreateNoteInFolder={onCreateNoteInFolder}
          onCreateFolderInFolder={onCreateFolderInFolder}
          onMoveNote={onMoveNote}
          onRenameFolder={onRenameFolder}
          onMoveFolder={onMoveFolder}
          onDeleteFolder={onDeleteFolder}
          onRestoreNote={onRestoreNote}
          onDeleteNotePermanently={onDeleteNotePermanently}
          onDrop={handleDrop}
          onDuplicateNote={handleDuplicateNote}
          setDragOverPath={setDragOverPath}
          setDraggingKey={setDraggingKey}
        />
        <VirtualRootRow
          key="__trash__"
          rootKey="__trash__"
          label="Trash"
          icon={Trash2}
          notes={trashList}
          expanded={expanded}
          onToggle={toggleVirtualRoot}
          depthStep={depthStep}
          noteBasePad={noteBasePad}
          folderOptions={folderOptions}
          selectedId={selectedId}
          multiActive={multiActive}
          selectedIds={selectedIds}
          bulk={bulk}
          draggingKey={draggingKey}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onMoveNote={onMoveNote}
          onRestoreNote={onRestoreNote}
          onDeleteNotePermanently={onDeleteNotePermanently}
          onDuplicateNote={handleDuplicateNote}
          setDragOverPath={setDragOverPath}
          setDraggingKey={setDraggingKey}
        />
      </div>

      {multiActive && (
        <BulkActionBar selectedIds={selectedIds} notes={notes} onClear={bulk.clear} />
      )}
    </div>
  );
}
