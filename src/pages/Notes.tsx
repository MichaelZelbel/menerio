import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SEOHead } from "@/components/SEOHead";
import {
  useNotes,
  useCreateNote,
  useUpdateNote,
  useIlikeSearch,
  useSemanticSearch,
  Note,
  SemanticSearchResult,
} from "@/hooks/useNotes";
import { NoteList } from "@/components/notes/NoteList";
import { NoteTree } from "@/components/notes/NoteTree";
import { NoteEditor } from "@/components/notes/NoteEditor";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus,
  Search,
  X,
  
  FileText,
  
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Filter,
  Check,
  Sparkles,
  Type,
  Image,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Hash,
  User,
  FolderPlus,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";


type SearchMode = "semantic" | "exact";
type SearchScope = "all" | "notes" | "media";
type SortField = "updated_at" | "created_at" | "title" | "manual";
type SortDirection = "asc" | "desc";

const sortLabels: Record<SortField, string> = {
  updated_at: "Last Edited",
  created_at: "Date Created",
  title: "Title",
  manual: "Manual",
};

const defaultDirections: Record<SortField, SortDirection> = {
  updated_at: "desc",
  created_at: "desc",
  title: "asc",
  manual: "desc",
};

const SORT_STORAGE_KEY = "menerio:notelist:sort";

export default function Notes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { noteId: urlNoteId } = useParams<{ noteId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  
  const [selectedId, setSelectedId] = useState<string | null>(urlNoteId || null);
  const [searchMode, setSearchMode] = useState(false);
  const [showLocalGraph, setShowLocalGraph] = useState(false);

  // Sync selectedId when URL param changes (e.g. from graph node click)
  useEffect(() => {
    if (urlNoteId && urlNoteId !== selectedId) {
      setSelectedId(urlNoteId);
    }
  }, [urlNoteId]);
  const [searchQuery, setSearchQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [searchType, setSearchType] = useState<SearchMode>("semantic");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [metaTypeFilter, setMetaTypeFilter] = useState<string | null>(null);
  const [activeFolderPath, setActiveFolderPath] = useState<string | null>("");
  const [newFolderPath, setNewFolderPath] = useState("");
  
  const [sortField, setSortField] = useState<SortField>(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.field && parsed.field in defaultDirections) return parsed.field as SortField;
      }
    } catch { /* ignore */ }
    return "updated_at";
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.direction === "asc" || parsed?.direction === "desc") return parsed.direction;
      }
    } catch { /* ignore */ }
    return "desc";
  });

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ field: sortField, direction: sortDirection }));
    } catch { /* ignore */ }
  }, [sortField, sortDirection]);

  const { data: allNotes = [], isLoading: loadingAll } = useNotes("all");
  const { data: favNotes = [] } = useNotes("favorites");
  const { data: trashNotes = [] } = useNotes("trash");
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const ilikeSearch = useIlikeSearch();
  const semanticSearch = useSemanticSearch();
  const [savedFolders, setSavedFolders] = useState<string[]>([]);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    destructive?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const refreshFolders = useCallback(async () => {
    const { data } = await supabase
      .from("note_folders" as any)
      .select("path")
      .order("path", { ascending: true });
    setSavedFolders(((data || []) as unknown as Array<{ path: string }>).map((f) => f.path));
  }, []);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const folderPaths = useMemo(() => {
    return [...new Set([
      ...savedFolders,
      ...allNotes.map((n) => n.folder_path || "").filter(Boolean),
    ])].sort((a, b) => a.localeCompare(b));
  }, [allNotes, savedFolders]);

  const createFolder = useCallback(async () => {
    const rawPath = newFolderPath.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
    const path = activeFolderPath && rawPath && !rawPath.includes("/") ? `${activeFolderPath}/${rawPath}` : rawPath;
    if (!path) return;
    const name = path.split("/").pop() || path;
    const parent_path = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
    const { error } = await supabase.from("note_folders" as any).upsert(
      { path, name, parent_path },
      { onConflict: "user_id,path" }
    );
    if (error) {
      showToast.error("Failed to create folder");
      return;
    }
    setNewFolderPath("");
    await refreshFolders();
    setActiveFolderPath(path);
  }, [activeFolderPath, newFolderPath, refreshFolders]);

  const createFolderAtPath = useCallback(async (path: string) => {
    const normalized = path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
    if (!normalized) return;
    const name = normalized.split("/").pop() || normalized;
    const parent_path = normalized.includes("/") ? normalized.split("/").slice(0, -1).join("/") : "";
    const { error } = await supabase.from("note_folders" as any).upsert(
      { path: normalized, name, parent_path },
      { onConflict: "user_id,path" }
    );
    if (error) {
      showToast.error("Failed to create folder");
      return;
    }
    await refreshFolders();
    setActiveFolderPath(normalized);
  }, [refreshFolders]);

  const selectNote = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      navigate(`/dashboard/notes/${id}`, { replace: true });
    } else {
      navigate("/dashboard/notes", { replace: true });
    }
  }, [navigate]);

  const handleCreate = useCallback(async () => {
    const note = await createNote.mutateAsync({ title: "", content: "", folder_path: activeFolderPath || "" });
    setSearchMode(false);
    selectNote(note.id);
  }, [activeFolderPath, createNote, selectNote]);

  // Detect "empty" notes: no meaningful title and no meaningful body content.
  // Strips HTML tags, empty markdown headings/list bullets/horizontal rules and all
  // whitespace (incl. &nbsp;) so notes that contain only invisible editor scaffolding
  // still count as empty. Notes with embedded images/videos keep markup and survive.
  const emptyNotes = useMemo(() => {
    return allNotes.filter((n) => {
      const title = (n.title || "").trim().toLowerCase();
      const titleEmpty = !title || title === "untitled";
      const bodyText = String(n.content || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/^#+\s*$/gm, "")
        .replace(/^[-*+]\s*$/gm, "")
        .replace(/^[-*_]{3,}\s*$/gm, "")
        .replace(/&nbsp;/gi, "")
        .replace(/[\s\u00A0]+/g, "");
      return titleEmpty && bodyText.length === 0;
    });
  }, [allNotes]);

  const [isTrashingEmpty, setIsTrashingEmpty] = useState(false);
  const handleTrashEmptyNotes = useCallback(async () => {
    if (emptyNotes.length === 0 || isTrashingEmpty) return;
    const count = emptyNotes.length;
    setConfirmState({
      title: `Move ${count} empty note${count === 1 ? "" : "s"} to Trash?`,
      description: `These notes have no title and no content. You can restore them from the Trash filter.`,
      confirmLabel: "Move to Trash",
      destructive: true,
      onConfirm: async () => {
        setIsTrashingEmpty(true);
        try {
          const ids = emptyNotes.map((n) => n.id);
          const { error } = await supabase
            .from("notes")
            .update({ is_trashed: true, trashed_at: new Date().toISOString() })
            .in("id", ids);
          if (error) throw error;
          if (selectedId && ids.includes(selectedId)) selectNote(null);
          await queryClient.invalidateQueries({ queryKey: ["notes"] });
          showToast.success(`Moved ${ids.length} empty note${ids.length === 1 ? "" : "s"} to Trash`);
        } catch (err) {
          showToast.error(err instanceof Error ? err.message : "Could not trash empty notes");
        } finally {
          setIsTrashingEmpty(false);
        }
      },
    });
  }, [emptyNotes, isTrashingEmpty, selectedId, selectNote, queryClient]);

  const handleCreateInFolder = useCallback(async (folderPath: string) => {
    setActiveFolderPath(folderPath);
    const note = await createNote.mutateAsync({ title: "", content: "", folder_path: folderPath || "" });
    setSearchMode(false);
    selectNote(note.id);
  }, [createNote, selectNote]);

  const handleCreateFolderInFolder = useCallback((folderPath: string) => {
    const folderName = window.prompt("Folder name");
    if (!folderName) return;
    const normalizedName = folderName.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
    if (!normalizedName) return;
    createFolderAtPath(folderPath ? `${folderPath}/${normalizedName}` : normalizedName);
  }, [createFolderAtPath]);

  const handleMoveNote = useCallback((noteId: string, folderPath: string) => {
    const normalizedTarget = (folderPath || "").replace(/^\/+|\/+$/g, "");
    const current = allNotes.find((n) => n.id === noteId);
    const currentFolder = (current?.folder_path || "").replace(/^\/+|\/+$/g, "");
    if (current && currentFolder === normalizedTarget) {
      setActiveFolderPath(normalizedTarget);
      return;
    }
    updateNote.mutate(
      { id: noteId, folder_path: normalizedTarget },
      {
        onSuccess: () => {
          const target = normalizedTarget || "Vault root";
          showToast.batched.success(`note:move:${target}`, (n) =>
            n === 1 ? `Moved to ${target}` : `${n} notes moved to ${target}`,
          );
        },
      },
    );
    setActiveFolderPath(normalizedTarget);
  }, [allNotes, updateNote]);

  // Rewrite folder path prefix for note_folders + notes (recursive).
  const rewriteFolderPrefix = useCallback(async (oldPath: string, newPath: string) => {
    // 1) Update affected note_folders rows
    const { data: affected, error: fetchErr } = await supabase
      .from("note_folders" as any)
      .select("path")
      .or(`path.eq.${oldPath},path.like.${oldPath}/%`);
    if (fetchErr) throw fetchErr;
    const rows = ((affected || []) as unknown as Array<{ path: string }>);
    for (const row of rows) {
      const suffix = row.path === oldPath ? "" : row.path.slice(oldPath.length);
      const next = newPath + suffix;
      const name = next.split("/").pop() || next;
      const parent_path = next.includes("/") ? next.split("/").slice(0, -1).join("/") : "";
      const { error: upErr } = await supabase
        .from("note_folders" as any)
        .update({ path: next, name, parent_path })
        .eq("path", row.path);
      if (upErr) throw upErr;
    }
    // 2) Update affected notes.folder_path
    const { data: affectedNotes, error: nFetchErr } = await supabase
      .from("notes" as any)
      .select("id, folder_path")
      .or(`folder_path.eq.${oldPath},folder_path.like.${oldPath}/%`);
    if (nFetchErr) throw nFetchErr;
    const noteRows = ((affectedNotes || []) as unknown as Array<{ id: string; folder_path: string }>);
    for (const n of noteRows) {
      const suffix = n.folder_path === oldPath ? "" : n.folder_path.slice(oldPath.length);
      const { error: upErr } = await supabase
        .from("notes" as any)
        .update({ folder_path: newPath + suffix })
        .eq("id", n.id);
      if (upErr) throw upErr;
    }
  }, []);

  const handleRenameFolder = useCallback(async (oldPath: string) => {
    if (!oldPath) return;
    const currentName = oldPath.split("/").pop() || oldPath;
    const input = window.prompt("Rename folder", currentName);
    if (!input) return;
    const newName = input.replace(/\//g, "").trim();
    if (!newName || newName === currentName) return;
    const parent = oldPath.includes("/") ? oldPath.split("/").slice(0, -1).join("/") : "";
    const newPath = parent ? `${parent}/${newName}` : newName;
    // Conflict check
    const { data: existing } = await supabase
      .from("note_folders" as any)
      .select("path")
      .eq("path", newPath)
      .maybeSingle();
    if (existing) {
      showToast.error(`A folder "${newPath}" already exists`);
      return;
    }
    try {
      await rewriteFolderPrefix(oldPath, newPath);
      await refreshFolders();
      await queryClient.invalidateQueries({ queryKey: ["notes"] });
      if (activeFolderPath === oldPath || activeFolderPath?.startsWith(oldPath + "/")) {
        setActiveFolderPath(newPath + (activeFolderPath.slice(oldPath.length)));
      }
      showToast.success("Folder renamed");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "Failed to rename folder");
    }
  }, [activeFolderPath, queryClient, refreshFolders, rewriteFolderPrefix]);

  const handleMoveFolder = useCallback(async (sourcePath: string, targetParentPath: string) => {
    if (!sourcePath) return;
    if (sourcePath === targetParentPath) return;
    if (targetParentPath === sourcePath || targetParentPath.startsWith(sourcePath + "/")) {
      showToast.error("Can't move a folder into itself");
      return;
    }
    const name = sourcePath.split("/").pop() || sourcePath;
    const newPath = targetParentPath ? `${targetParentPath}/${name}` : name;
    if (newPath === sourcePath) return;
    const { data: existing } = await supabase
      .from("note_folders" as any)
      .select("path")
      .eq("path", newPath)
      .maybeSingle();
    if (existing) {
      showToast.error(`A folder "${newPath}" already exists`);
      return;
    }
    try {
      await rewriteFolderPrefix(sourcePath, newPath);
      await refreshFolders();
      await queryClient.invalidateQueries({ queryKey: ["notes"] });
      if (activeFolderPath === sourcePath || activeFolderPath?.startsWith(sourcePath + "/")) {
        setActiveFolderPath(newPath + (activeFolderPath.slice(sourcePath.length)));
      }
      showToast.success(targetParentPath ? `Moved to ${targetParentPath}` : "Moved to Vault root");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "Failed to move folder");
    }
  }, [activeFolderPath, queryClient, refreshFolders, rewriteFolderPrefix]);

  const handleDeleteFolder = useCallback(async (path: string) => {
    if (!path) return;
    const affectedNotes = allNotes.filter(
      (n) => n.folder_path === path || (n.folder_path || "").startsWith(path + "/")
    );
    const subfolderCount = folderPaths.filter((p) => p !== path && p.startsWith(path + "/")).length;
    const parts: string[] = [];
    if (affectedNotes.length > 0) parts.push(`${affectedNotes.length} note${affectedNotes.length === 1 ? "" : "s"} will be moved to Trash`);
    if (subfolderCount > 0) parts.push(`${subfolderCount} subfolder${subfolderCount === 1 ? "" : "s"} will be deleted`);
    const detail = parts.length ? ` ${parts.join(". ")}.` : " This folder is empty.";
    setConfirmState({
      title: `Delete folder "${path}"?`,
      description: `${detail} Notes can be restored from the Trash filter.`,
      confirmLabel: "Delete folder",
      destructive: true,
      onConfirm: async () => {
        try {
          if (affectedNotes.length > 0) {
            const ids = affectedNotes.map((n) => n.id);
            const { error: nErr } = await supabase
              .from("notes" as any)
              .update({ is_trashed: true, trashed_at: new Date().toISOString() })
              .in("id", ids);
            if (nErr) throw nErr;
            if (selectedId && ids.includes(selectedId)) selectNote(null);
          }
          const { error: fErr } = await supabase
            .from("note_folders" as any)
            .delete()
            .or(`path.eq.${path},path.like.${path}/%`);
          if (fErr) throw fErr;
          await refreshFolders();
          await queryClient.invalidateQueries({ queryKey: ["notes"] });
          if (activeFolderPath === path || activeFolderPath?.startsWith(path + "/")) {
            const parent = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
            setActiveFolderPath(parent || null);
          }
          showToast.success(
            affectedNotes.length > 0
              ? `Folder deleted, ${affectedNotes.length} note${affectedNotes.length === 1 ? "" : "s"} moved to Trash`
              : "Folder deleted"
          );
        } catch (err) {
          showToast.error(err instanceof Error ? err.message : "Failed to delete folder");
        }
      },
    });
  }, [activeFolderPath, allNotes, folderPaths, queryClient, refreshFolders, selectedId, selectNote]);

  const handleRestoreNote = useCallback(async (noteId: string) => {
    try {
      const { error } = await supabase
        .from("notes")
        .update({ is_trashed: false, trashed_at: null })
        .eq("id", noteId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["notes"] });
      showToast.batched.success("note:restore", (n) =>
        n === 1 ? "Note restored" : `${n} notes restored`,
      );
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "Failed to restore note");
    }
  }, [queryClient]);

  const handleDeleteNotePermanently = useCallback((noteId: string) => {
    const target = allNotes.find((n) => n.id === noteId) || trashNotes.find((n) => n.id === noteId);
    const title = target?.title?.trim() || "Untitled";
    setConfirmState({
      title: `Delete "${title}" permanently?`,
      description: "This note and its attachments will be removed forever. This action cannot be undone.",
      confirmLabel: "Delete permanently",
      destructive: true,
      onConfirm: async () => {
        try {
          const { error } = await supabase.from("notes").delete().eq("id", noteId);
          if (error) throw error;
          if (selectedId === noteId) selectNote(null);
          await queryClient.invalidateQueries({ queryKey: ["notes"] });
          showToast.batched.success("note:delete-permanent", (n) =>
            n === 1 ? "Note deleted permanently" : `${n} notes deleted permanently`,
          );
        } catch (err) {
          showToast.error(err instanceof Error ? err.message : "Failed to delete note");
        }
      },
    });
  }, [allNotes, trashNotes, selectedId, selectNote, queryClient]);

  // Handle ?action=create from external "+ New Note" buttons (header, deep links).
  // Use a ref-guard so the effect fires exactly once per occurrence of action=create,
  // regardless of how many times handleCreate's identity changes due to mutation state.
  const createTriggerRef = useRef<string | null>(null);
  useEffect(() => {
    if (searchParams.get("action") !== "create") {
      createTriggerRef.current = null;
      return;
    }
    // Use the raw search string as a fingerprint so re-navigating to the same URL re-triggers.
    const fingerprint = searchParams.toString();
    if (createTriggerRef.current === fingerprint) return;
    createTriggerRef.current = fingerprint;

    // Strip the param synchronously, then run create on the next tick so React-Router
    // commits the URL change before the mutation kicks off (avoids race with re-mounts).
    setSearchParams({}, { replace: true });
    queueMicrotask(() => {
      handleCreate();
    });
  }, [searchParams, handleCreate, setSearchParams]);

  const counts = {
    all: allNotes.length,
    favorites: favNotes.length,
    trash: trashNotes.length,
  };

  const handleSearch = useCallback(
    (q: string) => {
      setSearchQuery(q);
      setSemanticResults(null);
      if (!q.trim()) return;
      ilikeSearch.mutate(q);
      if (searchType === "semantic") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          semanticSearch.mutate(
            { query: q, scope: searchScope },
            { onSuccess: (data) => setSemanticResults(data.results as SemanticSearchResult[]) }
          );
        }, 300);
      }
    },
    [ilikeSearch, semanticSearch, searchType, searchScope]
  );

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const searchResults: SemanticSearchResult[] | null = useMemo(() => {
    if (!searchMode || !searchQuery.trim()) return null;
    if (searchType === "exact") return ilikeSearch.data || null;
    return semanticResults || ilikeSearch.data || null;
  }, [searchMode, searchQuery, searchType, semanticResults, ilikeSearch.data]);

  const currentNotes = useMemo(() => {
    let notes: (Note | SemanticSearchResult)[];
    if (searchMode && searchResults) notes = searchResults;
    else notes = allNotes;


    if (entityFilter) {
      notes = notes.filter((n) => n.entity_type === entityFilter);
    }
    if (topicFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        const topics = Array.isArray(meta?.topics) ? (meta.topics as string[]) : [];
        return topics.includes(topicFilter);
      });
    }
    if (personFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        const people = Array.isArray(meta?.people) ? (meta.people as string[]) : [];
        // Check raw names and canonical names from matched_people
        const matchedMap = new Map<string, string>();
        if (Array.isArray(meta?.matched_people)) {
          for (const m of meta.matched_people as Array<{ name: string; canonical_name: string }>) {
            matchedMap.set(m.name.toLowerCase(), m.canonical_name);
          }
        }
        return people.some((p) => {
          const canonical = matchedMap.get(p.toLowerCase()) || p;
          return canonical === personFilter || p === personFilter;
        });
      });
    }
    if (metaTypeFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        return meta?.type === metaTypeFilter;
      });
    }
    // Sort: pinned first, then by selected field/direction (skip for "manual")
    const sorted = [...notes].sort((a, b) => {
      const aPinned = "is_pinned" in a && a.is_pinned ? 1 : 0;
      const bPinned = "is_pinned" in b && b.is_pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      if (sortField === "manual") return 0;

      const dir = sortDirection === "asc" ? 1 : -1;
      if (sortField === "title") {
        return dir * (a.title || "").localeCompare(b.title || "");
      }
      const aRaw = (a as unknown as Record<string, unknown>)[sortField];
      const bRaw = (b as unknown as Record<string, unknown>)[sortField];
      const aTs = typeof aRaw === "string" ? new Date(aRaw).getTime() : 0;
      const bTs = typeof bRaw === "string" ? new Date(bRaw).getTime() : 0;
      return dir * (aTs - bTs);
    });
    return sorted;
  }, [allNotes, searchMode, searchResults, entityFilter, topicFilter, personFilter, metaTypeFilter, sortField, sortDirection]);

  const selectedNote = useMemo(() => {
    if (!selectedId) return null;
    return (
      allNotes.find((n) => n.id === selectedId) ||
      trashNotes.find((n) => n.id === selectedId) ||
      favNotes.find((n) => n.id === selectedId) ||
      // Also check current search results (semantic/ilike may return notes not yet in cache)
      (searchResults ?? []).find((n) => n.id === selectedId) ||
      null
    );
  }, [selectedId, allNotes, trashNotes, favNotes, searchResults]);

  

  const exitSearch = () => {
    setSearchMode(false);
    setSearchQuery("");
    setSemanticResults(null);
  };

  const clearAllFilters = () => {
    setTopicFilter(null);
    setPersonFilter(null);
    setMetaTypeFilter(null);
  };

  const hasActiveMetaFilter = topicFilter || personFilter || metaTypeFilter;
  const isSemanticLoading = searchType === "semantic" && semanticSearch.isPending;
  const showingSemanticResults = searchType === "semantic" && semanticResults !== null;

  // Vault insights aggregation
  const TYPE_LABELS: Record<string, string> = {
    observation: "Observation", task: "Task", idea: "Idea", reference: "Reference",
    person_note: "Person Note", meeting_note: "Meeting Note", decision: "Decision", project: "Project",
  };
  const TYPE_COLORS: Record<string, string> = {
    observation: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
    task: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    idea: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    reference: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    person_note: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    meeting_note: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    decision: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    project: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  };

  const { topicCounts, peopleCounts, typeCounts, unclassifiedCount } = useMemo(() => {
    const topics: Record<string, number> = {};
    const people: Record<string, number> = {};
    const types: Record<string, number> = {};
    let unclassified = 0;
    for (const note of allNotes) {
      const meta = note.metadata as Record<string, unknown> | null;
      if (!meta || !meta.type) { unclassified++; continue; }
      if (Array.isArray(meta.topics)) for (const t of meta.topics as string[]) topics[t] = (topics[t] || 0) + 1;
      // Normalize people names: use canonical_name from matched_people when available
      const matchedMap = new Map<string, string>();
      if (Array.isArray(meta.matched_people)) {
        for (const m of meta.matched_people as Array<{ name: string; canonical_name: string }>) {
          matchedMap.set(m.name.toLowerCase(), m.canonical_name);
        }
      }
      if (Array.isArray(meta.people)) {
        for (const p of meta.people as string[]) {
          const canonical = matchedMap.get(p.toLowerCase()) || p;
          people[canonical] = (people[canonical] || 0) + 1;
        }
      }
      if (typeof meta.type === "string") types[meta.type] = (types[meta.type] || 0) + 1;
    }
    return {
      topicCounts: Object.entries(topics).sort((a, b) => b[1] - a[1]),
      peopleCounts: Object.entries(people).sort((a, b) => b[1] - a[1]),
      typeCounts: Object.entries(types).sort((a, b) => b[1] - a[1]),
      unclassifiedCount: unclassified,
    };
  }, [allNotes]);

  const [isBackfilling, setIsBackfilling] = useState(false);
  const handleBackfill = useCallback(async () => {
    setIsBackfilling(true);
    try {
      const res = await supabase.functions.invoke("backfill-metadata", { body: {} });
      if (res.error) throw res.error;
      const data = res.data as { processed: number; total: number; message: string };
      showToast.success(data.message);
    } catch (err: any) {
      showToast.error(err.message || "Backfill failed");
    } finally {
      setIsBackfilling(false);
    }
  }, []);

  return (
    <>
    <div className="flex h-[calc(100dvh-56px)] overflow-hidden">
      <SEOHead title="Notes — Menerio" noIndex />


      {/* Note list panel */}
      <div className={cn(
        "shrink-0 border-r border-border flex-col bg-background min-w-0",
        "w-full md:w-72",
        isMobile && selectedId ? "hidden" : "flex"
      )}>

        {/* Header */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
          <div className="flex flex-col text-sm font-semibold h-8 px-2 leading-tight">
            <div className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              {searchMode ? "Search" : "Notes"}
            </div>
            <span className="text-[10px] text-muted-foreground font-normal">
              {!searchMode && counts.all}
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={entityFilter ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                title="Filter by type"
              >
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => setEntityFilter(null)} className="gap-2">
                <span className="flex-1">All Types</span>
                {!entityFilter && <Check className="h-3 w-3" />}
              </DropdownMenuItem>
              {["person", "event", "idea", "prompt", "document", "note"].map((t) => (
                <DropdownMenuItem key={t} onClick={() => setEntityFilter(t)} className="gap-2">
                  <span className="flex-1 capitalize">{t}</span>
                  {entityFilter === t && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                title="Sort notes"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{sortLabels[sortField]}</span>
                {sortField !== "manual" && (
                  sortDirection === "asc"
                    ? <ArrowUp className="h-3 w-3" />
                    : <ArrowDown className="h-3 w-3" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {(Object.keys(sortLabels) as SortField[]).map((field) => (
                <DropdownMenuItem
                  key={field}
                  onClick={() => {
                    if (sortField === field && field !== "manual") {
                      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortField(field);
                      setSortDirection(defaultDirections[field]);
                    }
                  }}
                  className="gap-2"
                >
                  {sortField === field && field !== "manual" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <span className="w-3" />
                  )}
                  <span className="flex-1">{sortLabels[field]}</span>
                  {sortField === field && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="New folder">
                <FolderPlus className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Create folder</p>
              <div className="flex gap-2">
                <Input
                  value={newFolderPath}
                  onChange={(e) => setNewFolderPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
                  placeholder={activeFolderPath ? `${activeFolderPath}/New folder` : "Projects/Menerio"}
                  className="h-8 text-xs"
                />
                <Button size="sm" className="h-8" onClick={createFolder}>Add</Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Tags / Vault Insights popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={hasActiveMetaFilter ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                title="Tags & Insights"
              >
                <Hash className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0 max-h-[70vh] overflow-hidden">
              <ScrollArea className="max-h-[70vh]">
                <div className="p-3 space-y-1">
                  {/* By Type */}
                  <VaultSection label="By Type" icon={LayoutGrid} defaultOpen>
                    <div className="flex flex-wrap gap-1">
                      {typeCounts.map(([type, count]) => (
                        <button
                          key={type}
                          onClick={() => setMetaTypeFilter(metaTypeFilter === type ? null : type)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-full font-medium transition-all",
                            TYPE_COLORS[type] || "bg-muted text-muted-foreground",
                            metaTypeFilter === type && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                          )}
                        >
                          {TYPE_LABELS[type] || type} ({count})
                        </button>
                      ))}
                      {typeCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">No classified notes yet</p>
                      )}
                    </div>
                  </VaultSection>

                  <Separator />

                  {/* Topics */}
                  <VaultSection label="Topics" icon={Hash} defaultOpen>
                    <div className="flex flex-wrap gap-1">
                      {topicCounts.slice(0, 30).map(([topic, count]) => (
                        <button
                          key={topic}
                          onClick={() => setTopicFilter(topicFilter === topic ? null : topic)}
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium transition-all hover:bg-primary/20",
                            topicFilter === topic && "ring-2 ring-primary ring-offset-1 ring-offset-background bg-primary/20"
                          )}
                        >
                          {topic} <span className="opacity-60">{count}</span>
                        </button>
                      ))}
                      {topicCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">No topics extracted yet</p>
                      )}
                    </div>
                  </VaultSection>

                  <Separator />

                  {/* People */}
                  <VaultSection label="People" icon={User}>
                    <div className="space-y-0.5">
                      {peopleCounts.slice(0, 20).map(([person, count]) => (
                        <button
                          key={person}
                          onClick={() => setPersonFilter(personFilter === person ? null : person)}
                          className={cn(
                            "flex items-center gap-2 w-full text-left px-2 py-1 rounded-md text-xs hover:bg-accent/50 transition-colors",
                            personFilter === person && "bg-accent"
                          )}
                        >
                          <User className="h-3 w-3 text-violet-500 shrink-0" />
                          <span className="flex-1 truncate">{person}</span>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                        </button>
                      ))}
                      {peopleCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground px-2">No people mentioned yet</p>
                      )}
                    </div>
                  </VaultSection>

                  {/* Classify button */}
                  {unclassifiedCount > 0 && (
                    <>
                      <Separator />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs h-8"
                        onClick={handleBackfill}
                        disabled={isBackfilling}
                      >
                        {isBackfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Classify unclassified vault notes ({unclassifiedCount})
                      </Button>
                    </>
                  )}

                  {/* Trash empty notes */}
                  {emptyNotes.length > 0 && (
                    <>
                      <Separator />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs h-8"
                        onClick={handleTrashEmptyNotes}
                        disabled={isTrashingEmpty}
                      >
                        {isTrashingEmpty ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Trash {emptyNotes.length} empty note{emptyNotes.length === 1 ? "" : "s"}
                      </Button>
                    </>
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSearchMode(!searchMode)}
            title="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={createNote.isPending}
                title="New"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleCreate} disabled={createNote.isPending}>
                <FileText className="h-4 w-4 mr-2" /> New Note
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreateFolderInFolder("")}>
                <FolderPlus className="h-4 w-4 mr-2" /> New Folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Search bar */}
        {searchMode && (
          <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={searchType === "semantic" ? "Smart search…" : "Exact search…"}
                className="pl-8 pr-8 h-8 text-sm"
                autoFocus
              />
              <button
                onClick={exitSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={searchType === "semantic" ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-6 px-2 text-[10px] gap-1",
                      searchType === "semantic" && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                    onClick={() => {
                      setSearchType("semantic");
                      setSemanticResults(null);
                      if (searchQuery.trim()) handleSearch(searchQuery);
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    Smart
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">AI-powered semantic search</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={searchType === "exact" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => {
                      setSearchType("exact");
                      setSemanticResults(null);
                      if (searchQuery.trim()) ilikeSearch.mutate(searchQuery);
                    }}
                  >
                    <Type className="h-3 w-3" />
                    Exact
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Keyword matching</TooltipContent>
              </Tooltip>

              {/* Search scope — only visible in semantic mode */}
              {searchType === "semantic" && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">|</span>
                  {(["all", "notes", "media"] as SearchScope[]).map((s) => (
                    <Button
                      key={s}
                      variant={searchScope === s ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => {
                        setSearchScope(s);
                        setSemanticResults(null);
                        if (searchQuery.trim()) {
                          semanticSearch.mutate(
                            { query: searchQuery, scope: s },
                            { onSuccess: (data) => setSemanticResults(data.results as SemanticSearchResult[]) }
                          );
                        }
                      }}
                    >
                      {s === "media" && <Image className="h-3 w-3" />}
                      {s === "notes" && <FileText className="h-3 w-3" />}
                      {s === "all" && <Search className="h-3 w-3" />}
                      {s === "all" ? "All" : s === "notes" ? "Notes" : "Media"}
                    </Button>
                  ))}
                </>
              )}

              <div className="flex-1" />
              {isSemanticLoading && (
                <span className="text-[10px] text-muted-foreground animate-pulse flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> Thinking…
                </span>
              )}
              {showingSemanticResults && !isSemanticLoading && (
                <span className="text-[10px] text-primary flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> AI results
                </span>
              )}
            </div>
          </div>
        )}

        {/* Active filter indicators */}
        {hasActiveMetaFilter && (
          <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-1.5 flex-wrap">
            {topicFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1">
                #{topicFilter}
                <button onClick={() => setTopicFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {personFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 font-medium inline-flex items-center gap-1">
                @{personFilter}
                <button onClick={() => setPersonFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {metaTypeFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium inline-flex items-center gap-1">
                {metaTypeFilter.replace("_", " ")}
                <button onClick={() => setMetaTypeFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            <button onClick={clearAllFilters} className="text-[10px] text-muted-foreground hover:text-foreground ml-auto">
              Clear all
            </button>
          </div>
        )}

        {/* Note list */}
        {loadingAll ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : searchMode ? (
          <NoteList
            notes={currentNotes}
            selectedId={selectedId}
            onSelect={selectNote}
            showSimilarity={searchMode && showingSemanticResults}
            onTopicClick={(topic) => setTopicFilter(topicFilter === topic ? null : topic)}
            onCreateNote={handleCreate}
            emptyVariant="search"
          />
        ) : (
          <NoteTree
            notes={currentNotes}
            folderPaths={folderPaths}
            selectedId={selectedId}
            activeFolderPath={activeFolderPath}
            onSelectNote={selectNote}
            onSelectFolder={setActiveFolderPath}
            onCreateNoteInFolder={handleCreateInFolder}
            onCreateFolderInFolder={handleCreateFolderInFolder}
            onMoveNote={handleMoveNote}
            onRenameFolder={handleRenameFolder}
            onMoveFolder={handleMoveFolder}
            onDeleteFolder={handleDeleteFolder}
            onRestoreNote={handleRestoreNote}
            onDeleteNotePermanently={handleDeleteNotePermanently}
            sortField={sortField === "manual" ? "updated_at" : sortField}
            sortDirection={sortDirection}
            favoriteNotes={favNotes}
            trashedNotes={trashNotes}
          />

        )}
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onNoteDeleted={() => selectNote(null)}
            showLocalGraph={showLocalGraph}
            onToggleLocalGraph={() => setShowLocalGraph(prev => !prev)}
            onNoteSelect={selectNote}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="mb-4">
              <img src="/favicon.png" alt="Menerio" className="h-16 w-16 object-contain" />
            </div>
            <h3 className="text-lg font-semibold font-display mb-2">
              Your Open Knowledge System
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Select a note to view it, or create a new one to start capturing your thoughts.
            </p>
            <Button onClick={handleCreate} disabled={createNote.isPending} className="gap-2">
              <Plus className="h-4 w-4" /> New Note
            </Button>
          </div>
        )}
      </div>
    </div>
    <AlertDialog
      open={!!confirmState}
      onOpenChange={(open) => { if (!open) setConfirmState(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={confirmState?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            onClick={async () => {
              const action = confirmState?.onConfirm;
              setConfirmState(null);
              if (action) await action();
            }}
          >
            {confirmState?.confirmLabel || "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function VaultSection({ label, icon: Icon, defaultOpen = false, children }: { label: string; icon: any; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
