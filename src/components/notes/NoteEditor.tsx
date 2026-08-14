import { useState, useEffect, useCallback, useRef, createRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Markdown } from "tiptap-markdown";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import ImageExt from "@tiptap/extension-image";
import SuperscriptExt from "@tiptap/extension-superscript";
import SubscriptExt from "@tiptap/extension-subscript";
import { Table as TableExt } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { VideoEmbed } from "./extensions/VideoEmbed";
import { PdfEmbed } from "./extensions/PdfEmbed";
import { AudioEmbed } from "./extensions/AudioEmbed";
import { FileUploadHandler } from "./extensions/FileUploadHandler";
import { WikilinkExtension } from "./extensions/WikilinkExtension";
import { TaskListShortcut } from "./extensions/TaskListShortcut";
import { Note, useUpdateNote, useDeleteNote, useProcessNote, useCreateNote, useDuplicateNote } from "@/hooks/useNotes";
import { useSharedNote, useShareNote, useUnshareNote, useCopyShareLink, ShareNoteResult } from "@/hooks/useNoteSharing";
import { ModerationResult } from "@/lib/moderateContent";
import { ModerationBlockDialog } from "@/components/moderation/ModerationBlockDialog";
import { useGitHubConnection, useGitHubSyncExport, useSyncLogForNote } from "@/hooks/useGitHubSync";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ExternalNotePanel } from "./ExternalNotePanel";
import { WebClipPreview } from "./WebClipPreview";
import { ForwardToAppDialog } from "./ForwardToAppDialog";
import { WikilinkAutocomplete } from "./WikilinkAutocomplete";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { BacklinksPanel } from "./BacklinksPanel";
import { OutgoingLinksPanel } from "./OutgoingLinksPanel";
import { SuggestedLinksPanel } from "./SuggestedLinksPanel";

import { MediaAnalysisOverlay } from "./MediaAnalysisOverlay";
import { NoteAttachmentsPanel } from "./NoteAttachmentsPanel";
import { LocalGraphPanel } from "./LocalGraphPanel";
import { NoteMetadataEditor } from "./NoteMetadataEditor";
import { AiVisibilityButton } from "@/components/common/AiVisibilityButton";
import { LinkToNoteDialog } from "./LinkToNoteDialog";
import { NoteChatPanel } from "./NoteChatPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAICreditsGate } from "@/hooks/useAICreditsGate";
import { useAuth } from "@/contexts/AuthContext";
import { EditorToolbar } from "./EditorToolbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Star,
  Pin,
  Trash2,
  Copy,
  RotateCcw,
  Tag,
  X,
  Info,
  Loader2,
  Send,
  Sparkles,
  Link2,
  GitCommit,
  CheckCircle2,
  AlertCircle,
  Network,
  Code2,
  MessageSquare,
  Share2,
  Globe,
  LinkIcon,
  Unlink,
  Lock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Tags,
  Download,
  Users,
  MoreHorizontal,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { formatDistanceToNow, format } from "date-fns";
import { showToast } from "@/lib/toast";
import { normalizeNoteContent, stripLeadingH1, coalesceTaskList, looksLikeHtml } from "@/lib/note-content";
import { markdownToHtml, tiptapJsonToMarkdown } from "@/utils/markdown-converter";
import { resolveAttachmentImagesInHtml } from "@/lib/upload-attachment";
import { buildTitleMap, resolveWikilinksInHtml } from "@/lib/wikilink-resolver";
import {
  FLUSH_REQUEST_EVENT,
  FLUSH_DONE_EVENT,
  NOTE_UPDATED_EVENT,
} from "@/lib/note-ai-edit";

import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const AUTO_PROCESS_DELAY = 10_000;
// Low floor on purpose: short notes still deserve an embedding and people
// extraction. Anything below this is reported as "skipped (too short)".
const MIN_WORDS_FOR_PROCESSING = 3;


interface NoteEditorProps {
  note: Note;
  onNoteDeleted?: () => void;
  showLocalGraph?: boolean;
  onToggleLocalGraph?: () => void;
  onNoteSelect?: (noteId: string) => void;
}

/** Extract all wikilink noteIds from editor JSON content (resolved nodes only) */
function extractWikilinkIds(doc: any): string[] {
  const ids: string[] = [];
  function walk(node: any) {
    if (node.type === "wikilink" && node.attrs?.noteId) {
      ids.push(node.attrs.noteId);
    }
    if (node.content) node.content.forEach(walk);
  }
  if (doc) walk(doc);
  return [...new Set(ids)];
}

/** Extract raw `[[Title]]` strings from editor text (fallback for unresolved markdown) */
function extractRawWikilinkTitles(editor: { getText: () => string }): string[] {
  const text = editor.getText();
  const out = new Set<string>();
  const re = /\[\[([^[\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

function contentToEditorHtml(content: string | null | undefined, note: Pick<Note, "is_external" | "title">): string {
  let normalized = normalizeNoteContent(content);
  if (note.is_external) normalized = stripLeadingH1(normalized, note.title);
  return looksLikeHtml(normalized) ? normalized : markdownToHtml(normalized);
}

function normalizeEditorHtml(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

function normalizeSavedMarkdown(md: string | null | undefined): string {
  return (md ?? "").replace(/\r\n/g, "\n").trimEnd();
}

function editorToMarkdown(editor: { getJSON: () => any }): string {
  return tiptapJsonToMarkdown(editor.getJSON()).trimEnd();
}

function formatRelativeSaved(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

interface SaveIndicatorProps {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
  tick: number;
}

function SaveIndicator({ status, lastSavedAt }: SaveIndicatorProps) {
  if (status === "idle" && !lastSavedAt) return null;
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-destructive shrink-0 px-1.5 py-0.5 rounded bg-destructive/10">
        <AlertCircle className="h-3 w-3" />
        Save failed
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
        <CheckCircle2 className="h-3 w-3 text-success" />
        Saved · {formatRelativeSaved(lastSavedAt)}
      </span>
    );
  }
  return null;
}

/** Per-note AI indexing state. Silence was the actual bug: users could not tell
 *  a processed note from one that was never indexed. */
function ProcessingIndicator({ note }: { note: Pick<Note, "processing_status" | "processing_error" | "ai_visibility"> }) {
  const status = note.processing_status;
  if (!status || status === "processed") return null;
  const map: Record<string, { label: string; className: string }> = {
    processing: { label: "Indexing…", className: "bg-muted text-muted-foreground" },
    pending: { label: "Indexing pending", className: "bg-muted text-muted-foreground" },
    skipped_short: { label: "Not indexed · too short", className: "bg-muted text-muted-foreground" },
    skipped_empty: { label: "Not indexed · empty", className: "bg-muted text-muted-foreground" },
    skipped_no_credits: { label: "Not indexed · no AI credits", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    failed: { label: "Indexing failed", className: "bg-destructive/10 text-destructive" },
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <span
      title={note.processing_error || entry.label}
      className={cn("text-[10px] shrink-0 rounded px-1.5 py-0.5", entry.className)}
    >
      {entry.label}
    </span>
  );
}

function countMarkdownLinks(content: string | null | undefined): number {
  return ((content ?? "").match(/\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|https?:\/\/\S+|mailto:[^\s)]+/g) || []).length;
}

/** Sync manual_link connections based on wikilinks in content.
 *  Resolves both ID-bearing wikilink nodes AND raw `[[Title]]` text fallbacks. */
async function syncManualLinks(
  noteId: string,
  userId: string,
  linkedNoteIds: string[],
  rawTitles: string[] = [],
) {
  try {
    let allTargetIds = [...linkedNoteIds];
    if (rawTitles.length > 0) {
      const { data: matches } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .in("title", rawTitles);
      const titleMap = new Map<string, string>();
      (matches || []).forEach((r: any) => {
        if (r.title) titleMap.set(String(r.title).toLowerCase(), r.id);
      });
      for (const t of rawTitles) {
        const id = titleMap.get(t.toLowerCase());
        if (id) allTargetIds.push(id);
      }
    }
    allTargetIds = [...new Set(allTargetIds)].filter((id) => id !== noteId);

    const { data: existing } = await supabase
      .from("note_connections" as any)
      .select("id, target_note_id")
      .eq("source_note_id", noteId)
      .eq("connection_type", "manual_link")
      .eq("user_id", userId);

    const existingMap = new Map((existing || []).map((e: any) => [e.target_note_id, e.id]));
    const newTargets = new Set(allTargetIds);

    const toDelete = (existing || [])
      .filter((e: any) => !newTargets.has(e.target_note_id))
      .map((e: any) => e.id);

    if (toDelete.length > 0) {
      await supabase.from("note_connections" as any).delete().in("id", toDelete);
    }

    const toUpsert = allTargetIds
      .filter((id) => !existingMap.has(id))
      .map((targetId) => ({
        user_id: userId,
        source_note_id: noteId,
        target_note_id: targetId,
        connection_type: "manual_link",
        strength: 1.0,
        metadata: {},
      }));

    if (toUpsert.length > 0) {
      await supabase.from("note_connections" as any).insert(toUpsert);
    }
  } catch (err) {
    console.error("Failed to sync manual links:", err);
  }
}

/** Insert a wikilink at the current cursor, ensuring it doesn't get embedded inside a word.
 *  Adds whitespace padding when adjacent characters are word characters. */
function insertWikilinkSafely(editor: any, attrs: { noteId: string; noteTitle: string; displayText?: string }) {
  try {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    const isWordChar = (ch: string) => /\w/.test(ch);
    let prefix = "";
    let suffix = "";
    if (empty) {
      const before = state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n");
      const after = state.doc.textBetween(to, Math.min(state.doc.content.size, to + 1), "\n", "\n");
      if (before && isWordChar(before)) prefix = " ";
      if (after && isWordChar(after)) suffix = " ";
    }
    const chain = editor.chain().focus();
    if (prefix) chain.insertContent(prefix);
    chain.insertWikilink(attrs);
    if (suffix) chain.insertContent(suffix);
    chain.run();
  } catch {
    editor.commands.insertWikilink(attrs);
  }
}

export function NoteEditor({ note, onNoteDeleted, showLocalGraph: showLocalGraphProp, onToggleLocalGraph, onNoteSelect }: NoteEditorProps) {
  const isMobile = useIsMobile();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const processNote = useProcessNote();
  const createNote = useCreateNote();
  const shareNote = useShareNote();
  const unshareNote = useUnshareNote();
  const copyShareLink = useCopyShareLink();
  const duplicateNote = useDuplicateNote();
  const { data: sharedNote } = useSharedNote(note.id);
  const { checkCredits } = useAICreditsGate();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: ghConn } = useGitHubConnection();
  const ghSync = useGitHubSyncExport();
  const { data: syncLog } = useSyncLogForNote(note.id);

  // Title -> id map for resolving raw `[[Title]]` markdown into clickable
  // wikilink nodes. The queryFn must return JSON-safe rows: the global
  // IndexedDB persister serializes query data, and a Map would come back as a
  // plain object on the next cold boot (the "r.get is not a function" crash).
  // `select` rebuilds a real Map from both fetched and restored rows.
  const { data: titleMap } = useQuery({
    queryKey: ["wikilink-title-map", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user!.id)
        .eq("is_trashed", false);
      return (data || []) as Array<{ id: string; title: string | null }>;
    },
    select: buildTitleMap,
  });
  const titleMapRef = useRef(titleMap);
  useEffect(() => { titleMapRef.current = titleMap; }, [titleMap]);

  const resolveWikilinks = useCallback((html: string): string => {
    const m = titleMapRef.current;
    if (!m || !html || !html.includes("[[")) return html;
    return resolveWikilinksInHtml(html, m);
  }, []);
  const [title, setTitle] = useState(note.title);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const showLocalGraph = showLocalGraphProp ?? false;
  const [showLinkToNote, setShowLinkToNote] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [moderationBlock, setModerationBlock] = useState<ModerationResult | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<Note | null>(null);
  const [pendingDuplicateTitle, setPendingDuplicateTitle] = useState("");
  const [interactionGroupId, setInteractionGroupId] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState("meeting");
  const [interactionSummary, setInteractionSummary] = useState(note.title);
  // Wikilink autocomplete state
  const [wikilinkOpen, setWikilinkOpen] = useState(false);
  const [wikilinkPos, setWikilinkPos] = useState<{ top: number; left: number } | null>(null);
  const wikilinkInsertPos = useRef<number | null>(null);

  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The note the pending auto-process timer belongs to, plus a ref-held flush
  // so the []-dep unmount effect can fire it without a stale closure.
  const pendingProcessNoteIdRef = useRef<string | null>(null);
  const flushProcessingRef = useRef<() => void>(() => {});

  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const lastLocalContentRef = useRef(note.content ?? "");
  const pendingSaveContentRef = useRef<string | null>(null);
  const lastLocalTitleRef = useRef(note.title ?? "");
  const pendingSaveTitleRef = useRef<string | null>(null);
  const activeNoteIdRef = useRef(note.id);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    if (saveStatus !== "saved" || !lastSavedAt) return;
    const id = setInterval(() => setSavedTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [saveStatus, lastSavedAt]);
  // Reset save status when switching to a different note
  useEffect(() => {
    setSaveStatus("idle");
    setLastSavedAt(null);
  }, [note.id]);

  const triggerGitHubSync = useCallback((noteId: string) => {
    if (!ghConn?.sync_enabled || !ghConn?.repo_owner || !ghConn?.repo_name) return;
    if (ghConn.sync_direction !== "export" && ghConn.sync_direction !== "bidirectional") return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      ghSync.mutate({ noteId, action: "update" });
    }, 3000);
  }, [ghConn, ghSync]);

  // ---------------------------------------------------------------------
  // Serialized content autosave.
  //
  // Every content save funnels through here so that (a) only one write per
  // note is ever in flight — fast typing queues the latest payload instead of
  // racing several PATCHes — and (b) we remember the newest server
  // `updated_at` we produced, which lets the sync effect below ignore any
  // late-arriving, older copy of the note (that race silently reverted edits).
  // ---------------------------------------------------------------------
  const savingRef = useRef(false);
  const queuedContentRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedUpdatedAtRef = useRef<number>(
    note.updated_at ? new Date(note.updated_at).getTime() : 0,
  );

  const saveContentNow = useCallback(
    (md: string) => {
      if (savingRef.current) {
        queuedContentRef.current = md;
        return;
      }
      savingRef.current = true;
      setSaveStatus("saving");
      updateNote.mutate(
        { id: note.id, content: md },
        {
          onSuccess: (saved) => {
            savingRef.current = false;
            lastSavedContentRef.current = md;
            const ts = saved?.updated_at ? new Date(saved.updated_at).getTime() : Date.now();
            if (ts > lastSavedUpdatedAtRef.current) lastSavedUpdatedAtRef.current = ts;
            if (pendingSaveContentRef.current === md) pendingSaveContentRef.current = null;
            setSaveStatus("saved");
            setLastSavedAt(Date.now());
            const queued = queuedContentRef.current;
            queuedContentRef.current = null;
            if (queued !== null && queued !== md) saveContentNow(queued);
          },
          onError: () => {
            savingRef.current = false;
            // Keep the pending payload so unmount/next keystroke retries it.
            setSaveStatus("error");
            const queued = queuedContentRef.current;
            queuedContentRef.current = null;
            if (queued !== null && queued !== md) saveContentNow(queued);
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, updateNote],
  );

  const handleOpenAutocomplete = useCallback((pos: number) => {
    // Get caret position from editor view
    const editorEl = document.querySelector(".tiptap-editor .ProseMirror");
    if (!editorEl) return;
    const rect = editorEl.getBoundingClientRect();
    // Use selection coords
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const caretRect = range.getBoundingClientRect();
      setWikilinkPos({ top: caretRect.bottom, left: caretRect.left });
    } else {
      setWikilinkPos({ top: rect.top + 40, left: rect.left + 20 });
    }
    wikilinkInsertPos.current = pos;
    setWikilinkOpen(true);
  }, []);

  const handleWikilinkSelect = useCallback((title: string, noteId: string) => {
    if (!editor) return;
    insertWikilinkSafely(editor, { noteId, noteTitle: title });
    setWikilinkOpen(false);
  }, []);

  const handleWikilinkCreate = useCallback(async (title: string) => {
    if (!editor) return;
    try {
      const newNote = await createNote.mutateAsync({ title });
      insertWikilinkSafely(editor, { noteId: newNote.id, noteTitle: title });
      setWikilinkOpen(false);
    } catch {
      showToast.error("Failed to create note");
    }
  }, [createNote]);

  const handleNavigateToNote = useCallback((noteId: string, noteTitle?: string) => {
    if (noteId) {
      navigate(`/dashboard/notes/${noteId}`);
      return;
    }
    const resolvedId = noteTitle ? titleMapRef.current?.get(noteTitle.trim().toLowerCase()) : null;
    if (resolvedId) navigate(`/dashboard/notes/${resolvedId}`);
  }, [navigate]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        underline: false,
      }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      TextStyle,
      Color,
      ImageExt.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            "data-attachment-name": {
              default: null,
              parseHTML: (el: HTMLElement) => el.getAttribute("data-attachment-name"),
              renderHTML: (attrs: Record<string, unknown>) => {
                const v = attrs["data-attachment-name"];
                return v ? { "data-attachment-name": String(v) } : {};
              },
            },
          };
        },
      }),
      SuperscriptExt,
      SubscriptExt,
      TableExt.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      VideoEmbed,
      PdfEmbed,
      AudioEmbed,
      FileUploadHandler.configure({
        userId: user?.id || "",
        noteId: note.id,
        onUploadStart: () => setIsUploading(true),
        onUploadEnd: () => setIsUploading(false),
        onUploadError: (msg: string) => showToast.error(msg),
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: false,
      }),
      WikilinkExtension.configure({
        onNavigate: (noteId: string) => handleNavigateToNote(noteId),
        onOpenAutocomplete: (pos: number) => handleOpenAutocomplete(pos),
      }),
      TaskListShortcut,
    ],
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        const wikilinkEl = target.closest?.(".wikilink-node") as HTMLElement | null;
        if (!wikilinkEl) return false;
        const noteId = wikilinkEl.getAttribute("data-note-id") || "";
        const noteTitle = wikilinkEl.getAttribute("data-note-title") || "";
        if (!noteId && !noteTitle) return false;
        event.preventDefault();
        event.stopPropagation();
        handleNavigateToNote(noteId, noteTitle);
        return true;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;

        // Detect Markdown task-list syntax in the clipboard text.
        const hasTaskSyntax = /^\s*-\s\[[ xX]\]\s+/m.test(text);
        if (!hasTaskSyntax) return false;

        // Normalize blank-line-separated items, then convert MD → HTML so
        // we get real taskList/taskItem nodes regardless of how
        // tiptap-markdown handles pasted text internally.
        const normalized = coalesceTaskList(text);
        const html = markdownToHtml(normalized);
        if (!html) return false;

        event.preventDefault();
        editor?.chain().focus().insertContent(html).run();
        return true;
      },
    },
    content: (() => {
      // Convert Markdown deterministically to HTML so checklists and other
      // block constructs always render as real TipTap nodes on first load.
      return resolveWikilinks(contentToEditorHtml(note.content, note));
    })(),
    editable: !note.is_trashed && !note.is_external,
    onUpdate: ({ editor: e }) => {
      const md = editorToMarkdown(e);
      // Note: previously we skipped non-focused updates that appeared to remove links,
      // but that silently dropped legitimate user edits (e.g. continuation lines under
      // list items). Always persist what the editor produced.
      lastLocalContentRef.current = md;
      pendingSaveContentRef.current = md;
      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
      setSaveStatus("saving");
      contentSaveTimer.current = setTimeout(() => {
        saveContentNow(md);
        triggerGitHubSync(note.id);

        // Sync manual_link connections
        if (user) {
          const doc = e.getJSON();
          const linkedIds = extractWikilinkIds(doc);
          const rawTitles = extractRawWikilinkTitles(e);
          syncManualLinks(note.id, user.id, linkedIds, rawTitles);
          queryClient.invalidateQueries({ queryKey: ["backlinks"] });
        }
      }, 800);

      // Schedule auto AI processing. The pending note id is tracked so the
      // flush paths (note switch / unmount / tab hide) can still fire it.
      if (processTimer.current) clearTimeout(processTimer.current);
      pendingProcessNoteIdRef.current = note.id;
      processTimer.current = setTimeout(() => {
        processTimer.current = null;
        pendingProcessNoteIdRef.current = null;
        const text = e.getText();
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        if (words >= MIN_WORDS_FOR_PROCESSING && !note.is_trashed && checkCredits()) {
          processNote.mutate(note.id);
        }
      }, AUTO_PROCESS_DELAY);
    },

  });

  // Keep handleWikilinkSelect and handleWikilinkCreate referencing editor
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // FLUSH (never cancel) the pending auto-process timer. Cancelling it on note
  // switch / unmount was the reason notes typed and left within 10s were saved
  // but never AI-processed. `process-note` is idempotent per content version,
  // so firing early can't double-spend credits.
  const flushPendingProcessing = useCallback(() => {
    if (!processTimer.current) return;
    clearTimeout(processTimer.current);
    processTimer.current = null;
    const noteId = pendingProcessNoteIdRef.current;
    pendingProcessNoteIdRef.current = null;
    if (!noteId) return;
    const text = lastLocalContentRef.current ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    if (words < MIN_WORDS_FOR_PROCESSING) return;
    if (!checkCredits()) return;
    processNote.mutate(noteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkCredits, processNote]);

  useEffect(() => { flushProcessingRef.current = flushPendingProcessing; }, [flushPendingProcessing]);

  // Tab close / app backgrounding: flush before the timer dies with the page.
  useEffect(() => {
    const onHide = () => flushProcessingRef.current();
    const onVisibility = () => { if (document.visibilityState === "hidden") flushProcessingRef.current(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);



  // Set editor HTML and then asynchronously swap in resolved signed URLs for
  // any `data-attachment-name` placeholders. Fire-and-forget: this never
  // re-reads `editor.getHTML()` afterwards, so it cannot loop with the
  // autosave → invalidate → prop-change cycle that froze the app before.
  const setEditorContentWithAttachments = useCallback((html: string, sourceNoteId = activeNoteIdRef.current) => {
    if (!editor) return;
    editor.commands.setContent(html, { emitUpdate: false });
    if (!user?.id || !html.includes("data-attachment-name=")) return;
    resolveAttachmentImagesInHtml(html, user.id)
      .then((resolved) => {
        if (!editor || editor.isDestroyed || editor.isFocused) return;
        if (activeNoteIdRef.current !== sourceNoteId) return;
        if (resolved === html) return;
        editor.commands.setContent(resolved, { emitUpdate: false });
      })
      .catch((err) => console.warn("attachment resolver failed", err));
  }, [editor, user?.id]);

  // On unmount, FLUSH any pending debounced save before cancelling timers.
  // NoteEditor is remounted per note (key={note.id}) and torn down on
  // navigation, so merely *cancelling* the 800ms content/title timers here
  // silently dropped the last burst of edits when the user switched notes or
  // clicked a wikilink within the debounce window. The pending payload lives
  // in the refs; firing updateNote.mutate persists it (the mutation runs on
  // the shared query client, so it completes after this instance is gone).
  // We still cancel the process/sync timers — those are safe to drop.
  useEffect(() => {
    return () => {
      const pendingContent = queuedContentRef.current ?? pendingSaveContentRef.current;
      if (pendingContent !== null && pendingContent !== lastSavedContentRef.current) {
        updateNote.mutate({ id: note.id, content: pendingContent });
        pendingSaveContentRef.current = null;
      }
      const pendingTitle = pendingSaveTitleRef.current;
      if (pendingTitle !== null) {
        updateNote.mutate({ id: note.id, title: pendingTitle });
        pendingSaveTitleRef.current = null;
      }
      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
      flushProcessingRef.current();

      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when note changes
  useEffect(() => {
    const noteChanged = activeNoteIdRef.current !== note.id;
    if (noteChanged) {
      activeNoteIdRef.current = note.id;
      pendingSaveContentRef.current = null;
      pendingSaveTitleRef.current = null;
    }
    const incomingMatchesPendingTitle = pendingSaveTitleRef.current === note.title;
    const incomingMatchesLastLocalTitle = lastLocalTitleRef.current === note.title;
    const titleInputFocused = document.activeElement === titleInputRef.current;
    if (noteChanged || incomingMatchesPendingTitle || incomingMatchesLastLocalTitle || (!pendingSaveTitleRef.current && !titleInputFocused)) {
      setTitle(note.title);
      lastLocalTitleRef.current = note.title ?? "";
      if (incomingMatchesPendingTitle || noteChanged) pendingSaveTitleRef.current = null;
    }
    setShowTagInput(false);
    setShowInfo(false);
    setSourceMode(false);
    // Only cancel the pending auto-process timer when the note actually changes.
    // Previously this ran unconditionally, but autosave's onSuccess writes the
    // saved row back into the query cache (~1s after a keystroke), which changes
    // the `note.content` prop and re-runs this effect — cancelling the 10s timer
    // before it could ever fire. So auto-classification was effectively dead
    // during normal editing.
    if (noteChanged) {
      flushProcessingRef.current();

      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    }
    // Staleness guard: a notes-list refetch that started *before* the last
    // autosave can resolve *after* it. Applying that older row would push the
    // pre-edit text back into the editor, and the next autosave would then
    // persist it — silently losing the user's work. Ignore anything older than
    // the newest version this editor successfully wrote.
    const incomingTs = note.updated_at ? new Date(note.updated_at).getTime() : 0;
    if (noteChanged) {
      lastSavedUpdatedAtRef.current = incomingTs;
      lastSavedContentRef.current = null;
      queuedContentRef.current = null;
    } else if (incomingTs && incomingTs < lastSavedUpdatedAtRef.current) {
      editor?.setEditable(!note.is_trashed && !note.is_external, false);
      return;
    }
    const incomingMatchesPendingSave = normalizeSavedMarkdown(pendingSaveContentRef.current) === normalizeSavedMarkdown(note.content);
    const incomingMatchesLastLocal = normalizeSavedMarkdown(lastLocalContentRef.current) === normalizeSavedMarkdown(note.content);
    if (!editor) return;

    if (!noteChanged && (incomingMatchesPendingSave || incomingMatchesLastLocal || pendingSaveContentRef.current || editor.isFocused)) {
      if (incomingMatchesPendingSave || incomingMatchesLastLocal) pendingSaveContentRef.current = null;
      editor.setEditable(!note.is_trashed && !note.is_external, false);
      return;
    }

    const editorContent = resolveWikilinks(contentToEditorHtml(note.content, note));
    const currentHtml = editor.getHTML();
    const incomingMatchesEditor = normalizeEditorHtml(editorContent) === normalizeEditorHtml(currentHtml);

    if (noteChanged) {
      if (!incomingMatchesEditor) {
        setEditorContentWithAttachments(editorContent, note.id);
      }
      lastLocalContentRef.current = note.content ?? "";
      pendingSaveContentRef.current = null;
    } else if (!incomingMatchesEditor && !incomingMatchesPendingSave && !incomingMatchesLastLocal && !pendingSaveContentRef.current && !editor.isFocused) {
      setEditorContentWithAttachments(editorContent, note.id);
      lastLocalContentRef.current = note.content ?? "";
    }
    if (incomingMatchesPendingSave || incomingMatchesEditor) {
      pendingSaveContentRef.current = null;
    }
    editor.setEditable(!note.is_trashed && !note.is_external, false);
  }, [note.id, note.content, note.updated_at, note.title, note.folder_path, note.is_external, note.is_trashed, editor, setEditorContentWithAttachments]);

  // The AI chat asks us to persist any pending autosave BEFORE it runs, so the
  // agent always reads (and writes on top of) the user's newest text. We answer
  // with the note's newest `updated_at`, which the chat sends as its edit base.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ noteId?: string; requestId?: string }>).detail;
      if (!detail?.noteId || detail.noteId !== note.id || !detail.requestId) return;
      const respond = (updatedAt: string | null, content: string | null) =>
        window.dispatchEvent(
          new CustomEvent(FLUSH_DONE_EVENT, {
            detail: { requestId: detail.requestId, noteId: note.id, updatedAt, content },
          }),
        );
      try {
        if (contentSaveTimer.current) {
          clearTimeout(contentSaveTimer.current);
          contentSaveTimer.current = null;
        }
        // Wait for any in-flight save to land (bounded).
        for (let i = 0; i < 40 && savingRef.current; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const pending = queuedContentRef.current ?? pendingSaveContentRef.current;
        if (pending !== null && pending !== lastSavedContentRef.current) {
          savingRef.current = true;
          try {
            const saved = await updateNote.mutateAsync({ id: note.id, content: pending });
            lastSavedContentRef.current = pending;
            queuedContentRef.current = null;
            if (pendingSaveContentRef.current === pending) pendingSaveContentRef.current = null;
            const ts = saved?.updated_at ? new Date(saved.updated_at).getTime() : Date.now();
            if (ts > lastSavedUpdatedAtRef.current) lastSavedUpdatedAtRef.current = ts;
            setSaveStatus("saved");
            setLastSavedAt(Date.now());
            respond(
              saved?.updated_at ?? new Date(lastSavedUpdatedAtRef.current).toISOString(),
              pending,
            );
            return;
          } finally {
            savingRef.current = false;
          }
        }
        const latest = lastSavedUpdatedAtRef.current
          ? new Date(lastSavedUpdatedAtRef.current).toISOString()
          : (note.updated_at ?? null);
        respond(latest, lastSavedContentRef.current ?? note.content ?? null);
      } catch {
        respond(null, null);
      }
    };
    window.addEventListener(FLUSH_REQUEST_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLUSH_REQUEST_EVENT, handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.updated_at, updateNote]);

  // Listen for AI-driven updates (from FAB chat or side panel) and refresh
  // the editor live so the user sees the agent's edits without reloading.
  //
  // The chat passes the exact resulting content, so we apply it directly rather
  // than refetching — and we apply it even when the editor is focused, because
  // otherwise the next autosave would push our stale copy back over the AI's
  // edit (that is how AI edits used to disappear).
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ noteId?: string; content?: string; updatedAt?: string }>).detail;
      if (!detail?.noteId || detail.noteId !== note.id) return;
      try {
        let content = detail.content;
        let updatedAt = detail.updatedAt;
        if (typeof content !== "string") {
          const { data, error } = await supabase
            .from("notes")
            .select("content, updated_at, tags, metadata")
            .eq("id", note.id)
            .single();
          if (error || !data) return;
          content = ((data as any).content || "") as string;
          updatedAt = (data as any).updated_at;
        }
        const html = resolveWikilinks(contentToEditorHtml(content, note));
        if (editor && normalizeEditorHtml(html) !== normalizeEditorHtml(editor.getHTML())) {
          const wasFocused = editor.isFocused;
          const caret = editor.state.selection.from;
          // Drop any queued autosave of the pre-edit text — it is stale now.
          if (contentSaveTimer.current) {
            clearTimeout(contentSaveTimer.current);
            contentSaveTimer.current = null;
          }
          queuedContentRef.current = null;
          pendingSaveContentRef.current = null;
          setEditorContentWithAttachments(html, note.id);
          lastLocalContentRef.current = content;
          lastSavedContentRef.current = content;
          if (updatedAt) {
            const ts = new Date(updatedAt).getTime();
            if (ts > lastSavedUpdatedAtRef.current) lastSavedUpdatedAtRef.current = ts;
          }
          if (wasFocused) {
            const max = editor.state.doc.content.size;
            editor.commands.focus(Math.min(caret, Math.max(0, max - 1)));
          }
          setSaveStatus("saved");
        }
        // Refresh the cached note in React Query so list/sidebar update too.
        queryClient.invalidateQueries({ queryKey: ["note", note.id] });
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        queryClient.invalidateQueries({ queryKey: ["backlinks"] });
      } catch {
        // ignore
      }
    };
    window.addEventListener(NOTE_UPDATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(NOTE_UPDATED_EVENT, handler as EventListener);
  }, [note.id, note.is_external, note.title, editor, queryClient, setEditorContentWithAttachments]);


  // One-shot attachment resolution on editor mount. Replaces the previous
  // reactive effect, which fed itself through `note.content` → autosave →
  // query invalidate → prop change → effect re-runs, freezing the app.
  // Subsequent note switches and external updates call
  // `setEditorContentWithAttachments` directly at their `setContent` site.
  useEffect(() => {
    if (!editor || !user?.id) return;
    const sourceNoteId = activeNoteIdRef.current;
    const html = editor.getHTML();
    if (!html.includes("data-attachment-name=")) return;
    resolveAttachmentImagesInHtml(html, user.id)
      .then((resolved) => {
        if (!editor || editor.isDestroyed || editor.isFocused) return;
        if (activeNoteIdRef.current !== sourceNoteId) return;
        if (resolved === html) return;
        editor.commands.setContent(resolved, { emitUpdate: false });
      })
      .catch((err) => console.warn("attachment resolver failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const checkDuplicateTitle = async (nextTitle: string) => {
    const cleanTitle = nextTitle.trim();
    if (!cleanTitle || cleanTitle === note.title) return null;
    const { data } = await supabase
      .from("notes" as any)
      .select("id, title, content, tags, metadata, folder_path, user_id, is_trashed")
      .eq("user_id", note.user_id)
      .eq("folder_path", note.folder_path || "")
      .eq("is_trashed", false)
      .ilike("title", cleanTitle)
      .neq("id", note.id)
      .limit(1)
      .maybeSingle();
    return data as unknown as Note | null;
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    lastLocalTitleRef.current = val;
    pendingSaveTitleRef.current = val;
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    setSaveStatus("saving");
    titleSaveTimer.current = setTimeout(async () => {
      const duplicate = await checkDuplicateTitle(val);
      if (duplicate) {
        setDuplicateTarget(duplicate);
        setPendingDuplicateTitle(val);
        return;
      }
      updateNote.mutate(
        { id: note.id, title: val },
        {
          onSuccess: () => {
            if (pendingSaveTitleRef.current === val) pendingSaveTitleRef.current = null;
            setSaveStatus("saved");
            setLastSavedAt(Date.now());
          },
          onError: () => {
            if (pendingSaveTitleRef.current === val) pendingSaveTitleRef.current = null;
            setSaveStatus("error");
          },
        }
      );
      triggerGitHubSync(note.id);
    }, 800);
  };

  const mergeDuplicate = async () => {
    if (!duplicateTarget) return;
    const currentContent = pendingSaveContentRef.current ?? (editor ? editorToMarkdown(editor) : note.content ?? "");
    const mergedContent = `${duplicateTarget.content || ""}\n\n---\n\n## Merged on ${format(new Date(), "yyyy-MM-dd")}\n\n${currentContent}`.trimEnd();
    const tags = [...new Set([...(duplicateTarget.tags || []), ...(note.tags || [])])];
    await updateNote.mutateAsync({ id: duplicateTarget.id, content: mergedContent, tags });
    await updateNote.mutateAsync({ id: note.id, is_trashed: true, trashed_at: new Date().toISOString() });
    setDuplicateTarget(null);
    showToast.success("Notes merged");
    navigate(`/dashboard/notes/${duplicateTarget.id}`);
  };

  // "Make a copy": flush any pending autosave first so the copy contains the
  // newest text, then duplicate and open the copy.
  const makeACopy = async () => {
    if (contentSaveTimer.current) {
      clearTimeout(contentSaveTimer.current);
      contentSaveTimer.current = null;
    }
    for (let i = 0; i < 40 && savingRef.current; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const pendingContent = queuedContentRef.current ?? pendingSaveContentRef.current;
    const pendingTitle = pendingSaveTitleRef.current;
    try {
      if (pendingContent !== null && pendingContent !== lastSavedContentRef.current) {
        savingRef.current = true;
        try {
          await updateNote.mutateAsync({ id: note.id, content: pendingContent });
          lastSavedContentRef.current = pendingContent;
          queuedContentRef.current = null;
          pendingSaveContentRef.current = null;
        } finally {
          savingRef.current = false;
        }
      }
      if (pendingTitle !== null && pendingTitle !== note.title) {
        await updateNote.mutateAsync({ id: note.id, title: pendingTitle });
        pendingSaveTitleRef.current = null;
      }
      const copy = await duplicateNote.mutateAsync(note.id);
      navigate(`/dashboard/notes/${copy.id}`);
    } catch {
      // useDuplicateNote / useUpdateNote surface their own error toasts.
    }
  };

  const keepDuplicateSafely = () => {
    updateNote.mutate({ id: note.id, title: pendingDuplicateTitle, metadata: { ...(note.metadata || {}), allow_duplicate_title: true } });
    setDuplicateTarget(null);
    triggerGitHubSync(note.id);
  };

  const toggleFavorite = () => updateNote.mutate({ id: note.id, is_favorite: !note.is_favorite });
  const togglePin = () => updateNote.mutate({ id: note.id, is_pinned: !note.is_pinned });

  const aiHidden = (note as any).ai_visibility === "hidden";

  const downloadMarkdown = () => {
    try {
      const currentMarkdown = sourceMode ? sourceText : editor ? editorToMarkdown(editor) : note.content || "";
      const safeTitle = title.trim() || "Untitled";
      const yamlString = (value: string) => JSON.stringify(value || "");
      const frontmatter = [
        "---",
        `id: ${yamlString(note.id)}`,
        `title: ${yamlString(safeTitle)}`,
        `created: ${yamlString(note.created_at)}`,
        `modified: ${yamlString(note.updated_at)}`,
        ...(note.tags?.length ? [`tags: [${note.tags.map(yamlString).join(", ")}]`] : []),
        ...(note.entity_type ? [`type: ${yamlString(note.entity_type)}`] : []),
        "---",
        "",
      ].join("\n");
      const markdown = `${frontmatter}${currentMarkdown.trimEnd()}\n`;
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeTitle.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "note"}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast.success("Markdown downloaded");
    } catch (error) {
      console.error("Markdown download failed", error);
      showToast.error("Could not download Markdown");
    }
  };

  const moveToTrash = () => {
    updateNote.mutate({ id: note.id, is_trashed: true, trashed_at: new Date().toISOString() });
    if (ghConn?.sync_enabled && (ghConn.sync_direction === "export" || ghConn.sync_direction === "bidirectional")) {
      ghSync.mutate({ noteId: note.id, action: "delete" });
    }
    showToast.success("Note moved to trash");
  };

  const restoreFromTrash = () => {
    updateNote.mutate({ id: note.id, is_trashed: false, trashed_at: null });
    showToast.success("Note restored");
  };

  const permanentDelete = () => {
    deleteNote.mutate(note.id);
    setShowDeleteDialog(false);
    onNoteDeleted?.();
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || note.tags?.includes(tag)) { setTagInput(""); return; }
    updateNote.mutate({ id: note.id, tags: [...(note.tags || []), tag] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    updateNote.mutate({ id: note.id, tags: (note.tags || []).filter((t) => t !== tag) });
  };

  const logGroupInteraction = async () => {
    if (!user || !selectedInteractionGroup) return;
    const { error } = await supabase.from("contact_interactions").insert({
      user_id: user.id,
      contact_id: selectedInteractionGroup.personId,
      group_id: selectedInteractionGroup.groupId,
      note_id: note.id,
      type: interactionType,
      summary: interactionSummary.trim() || title,
      interaction_date: note.created_at,
    });
    if (error) {
      showToast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["contact-interactions"] });
    setInteractionGroupId(null);
    showToast.success("Logged as interaction");
  };

  const plainText = editor?.getText() || "";
  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
  const charCount = plainText.length;
  const metadata = note.metadata as Record<string, unknown> | null;
  const mentionedPeople = Array.isArray(metadata?.people) ? (metadata.people as string[]) : [];
  const { data: mentionedGroupMatches = [] } = useQuery({
    queryKey: ["note-mentioned-groups", note.id, mentionedPeople],
    enabled: !!user && mentionedPeople.length > 0,
    queryFn: async () => {
      const { data: contacts, error: contactsError } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("user_id", user!.id)
        .in("name", mentionedPeople);
      if (contactsError) throw contactsError;
      const personIds = ((contacts || []) as Array<{ id: string; name: string }>).map((contact) => contact.id);
      if (personIds.length === 0) return [];
      const { data, error } = await supabase
        .from("contact_group_memberships")
        .select("contact_id, contact_groups:group_id(id, name, slug, icon)")
        .eq("user_id", user!.id)
        .in("contact_id", personIds)
        .is("archived_at", null);
      if (error) throw error;
      const contactNameById = new Map(((contacts || []) as Array<{ id: string; name: string }>).map((contact) => [contact.id, contact.name]));
      return ((data || []) as Array<{ contact_id: string; contact_groups: { id: string; name: string; slug: string; icon: string | null } | null }>).map((membership) => ({
        personId: membership.contact_id,
        personName: contactNameById.get(membership.contact_id) || "",
        groupId: membership.contact_groups?.id as string,
        groupName: membership.contact_groups?.name as string,
        groupSlug: membership.contact_groups?.slug as string,
        groupIcon: membership.contact_groups?.icon as string | null,
      })).filter((match) => match.groupId && match.groupName);
    },
  });
  const mentionedGroups = [...new Map(mentionedGroupMatches.map((match) => [match.groupId, match])).values()];
  const selectedInteractionGroup = mentionedGroups.find((group) => group.groupId === interactionGroupId) || null;
  const syncStatus = syncLog?.sync_status;
  const isSyncing = ghSync.isPending;

  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    if (!sourceMode) {
      // Rich → Source
      const md = editorToMarkdown(editor);
      setSourceText(md);
      setSourceMode(true);
    } else {
      // Source → Rich
      setEditorContentWithAttachments(resolveWikilinks(contentToEditorHtml(sourceText, { ...note, is_external: false })));
      lastLocalContentRef.current = sourceText;
      pendingSaveContentRef.current = sourceText;
      // trigger save
      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
      contentSaveTimer.current = setTimeout(() => {
        const md = editorToMarkdown(editor);
        pendingSaveContentRef.current = md;
        saveContentNow(md);
        triggerGitHubSync(note.id);
      }, 800);
      setSourceMode(false);
    }
  }, [editor, sourceMode, sourceText, note, saveContentNow, triggerGitHubSync]);

  return (
    <div className="flex h-full">
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Action toolbar — only for trashed/source-mode/external notes; for normal notes, actions are merged into the formatting toolbar below */}
      {(note.is_trashed || sourceMode || note.is_external) && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background shrink-0">
          {sharedNote?.is_active && (
            <Badge variant="outline" className="h-6 gap-1 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" /> Shared
            </Badge>
          )}
          {note.is_trashed ? (
            <>
              <Button variant="ghost" size="sm" onClick={restoreFromTrash} className="gap-1.5 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowDeleteDialog(true)} className="gap-1.5 text-xs text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Delete Forever
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFavorite} title={note.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                <Star className={cn("h-4 w-4", note.is_favorite && "fill-warning text-warning")} />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePin} title={note.is_pinned ? "Unpin" : "Pin to top"}>
                <Pin className={cn("h-4 w-4", note.is_pinned && "text-primary")} />
              </Button>
              {!note.is_external && (
                <Button variant="ghost" size="icon" className={cn("h-8 w-8", sourceMode && "bg-accent text-accent-foreground")} onClick={toggleSourceMode} title={sourceMode ? "Rich text mode" : "Markdown source"}>
                  <Code2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className={cn("h-8 w-8", showChat && "bg-accent text-accent-foreground")} onClick={() => setShowChat(!showChat)} title="AI Chat">
                <MessageSquare className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Info panel */}
      {showInfo && (
        <div className="px-4 py-3 border-b border-border bg-muted/30 text-xs text-muted-foreground space-y-1 shrink-0">
          <p>Created: {format(new Date(note.created_at), "PPp")}</p>
          <p>Updated: {format(new Date(note.updated_at), "PPp")}</p>
          <p>{wordCount} words · {charCount} characters</p>
          {metadata?.type && <p>Type: {String(metadata.type)}</p>}
          {metadata?.summary && <p>Summary: {String(metadata.summary)}</p>}
          {Array.isArray(metadata?.topics) && (metadata.topics as string[]).length > 0 && (
            <p>Topics: {(metadata.topics as string[]).join(", ")}</p>
          )}
          {Array.isArray(metadata?.people) && (metadata.people as string[]).length > 0 && (
            <p>People: {(metadata.people as string[]).join(", ")}</p>
          )}
          {Array.isArray(metadata?.action_items) && (metadata.action_items as string[]).length > 0 && (
            <p>Action items: {(metadata.action_items as string[]).join("; ")}</p>
          )}
        </div>
      )}

      {mentionedGroups.length > 0 && !note.is_trashed && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-muted-foreground">
          <span>This note mentions members of:</span>
          {mentionedGroups.map((group) => (
            <button
              key={group.groupId}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 font-medium text-foreground hover:text-primary"
              onClick={() => { setInteractionGroupId(group.groupId); setInteractionSummary(title); }}
            >
              {group.groupIcon ? <span>{group.groupIcon}</span> : <Users className="h-3 w-3" />}
              {group.groupName}
            </button>
          ))}
        </div>
      )}


      {/* Rich text formatting toolbar — hidden for external read-only notes */}
      {!note.is_trashed && !sourceMode && !note.is_external && (
        <EditorToolbar
          editor={editor}
          onInsertWikilink={() => {
            const pos = editor?.state.selection.from ?? 0;
            handleOpenAutocomplete(pos);
          }}
          quickActions={
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFavorite} title={note.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                <Star className={cn("h-3.5 w-3.5", note.is_favorite && "fill-warning text-warning")} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePin} title={note.is_pinned ? "Unpin" : "Pin to top"}>
                <Pin className={cn("h-3.5 w-3.5", note.is_pinned && "text-primary")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7", showChat && "bg-accent text-accent-foreground")}
                onClick={() => setShowChat(!showChat)}
                title="AI Chat"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              {sharedNote?.is_active && (
                <Badge variant="outline" className="h-6 gap-1 text-xs text-muted-foreground ml-1">
                  <Globe className="h-3 w-3" /> Shared
                </Badge>
              )}
              <AiVisibilityButton
                kind="note"
                id={note.id}
                hidden={aiHidden}
                className="ml-1"
              />
              <Separator orientation="vertical" className="h-5 mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => window.open(`/dashboard/notes/${note.id}`, "_blank")}
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                onClick={moveToTrash}
                title="Move to trash"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          }
          noteActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="More actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setShowInfo(!showInfo)}>
                  <Info className="mr-2 h-4 w-4" /> Note info
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowTagInput(!showTagInput)}>
                  <Tag className="mr-2 h-4 w-4" /> Add tag
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleSourceMode}>
                  <Code2 className="mr-2 h-4 w-4" /> {sourceMode ? "Rich text mode" : "Markdown source"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => setShowConnections(!showConnections)}>
                  <Link2 className="mr-2 h-4 w-4" /> Find connections
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleLocalGraph?.()}>
                  <Network className="mr-2 h-4 w-4" /> Local graph
                </DropdownMenuItem>
                {syncLog && (
                  <DropdownMenuItem onClick={() => setShowHistory(!showHistory)}>
                    <GitCommit className="mr-2 h-4 w-4" /> Version history
                  </DropdownMenuItem>
                )}

                {!metadata?.type && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => { if (checkCredits()) processNote.mutate(note.id); }}
                      disabled={processNote.isPending}
                    >
                      {processNote.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Classify with AI
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={makeACopy} disabled={duplicateNote.isPending}>
                  <Copy className="mr-2 h-4 w-4" /> Make a copy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${title}\n\n${plainText}`); showToast.success("Copied to clipboard"); }}>
                  <Copy className="mr-2 h-4 w-4" /> Copy to clipboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadMarkdown}>
                  <Download className="mr-2 h-4 w-4" /> Download Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/dashboard/notes/${note.id}`); showToast.copied(); }}>
                  <Link2 className="mr-2 h-4 w-4" /> Copy note link
                </DropdownMenuItem>
                {sharedNote?.is_active ? (
                  <>
                    <DropdownMenuItem onClick={() => copyShareLink.mutate(sharedNote.share_token)}>
                      <Globe className="mr-2 h-4 w-4" /> Copy public link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => unshareNote.mutate(note.id)}>
                      <Unlink className="mr-2 h-4 w-4" /> Stop sharing
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onClick={() => shareNote.mutate({ noteId: note.id, title, content: editor?.getHTML() || note.content }, { onSuccess: (result: ShareNoteResult) => { if (result.blocked && result.moderation) setModerationBlock(result.moderation); } })}
                    disabled={shareNote.isPending}
                  >
                    <Share2 className="mr-2 h-4 w-4" /> Share publicly
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowForwardDialog(true)}>
                  <Send className="mr-2 h-4 w-4" /> Send to app
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      )}

      {/* Synced-note banner: explains read-only state and offers an immediate path to edit. */}
      {!note.is_trashed && note.is_external && (
        <div className="flex items-start gap-3 px-3 py-2.5 border-b border-border bg-accent/30">
          <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground">
              Synced from <span className="font-medium">{note.source_app || "external app"}</span> — duplicate to edit
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Changes here would be overwritten on the next sync. Create a local copy to make edits in Menerio.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {note.source_url && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => window.open(note.source_url!, "_blank")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in {note.source_app || "App"}
              </Button>
            )}
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={async () => {
                try {
                  const newNote = await createNote.mutateAsync({
                    title: `${note.title} (copy)`,
                    content: editor?.getHTML() || note.content,
                    tags: note.tags || [],
                  });
                  showToast.success("Duplicated to a local note");
                  navigate(`/notes?id=${newNote.id}`);
                } catch {
                  showToast.error("Failed to duplicate note");
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate to edit
            </Button>
          </div>
        </div>
      )}

      {/* Note Metadata editor — moved below text, rendered before Vault Insights */}

      {/* Editor */}
      <div
        ref={editorContainerRef}
        className={cn(
          "flex-1 overflow-y-auto p-4 relative transition-colors flex flex-col min-h-0",
          isDragOver && "bg-primary/5 ring-2 ring-primary/30 ring-inset"
        )}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
        onDrop={() => setIsDragOver(false)}
      >
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-background/90 border-2 border-dashed border-primary rounded-lg px-6 py-4 text-sm font-medium text-primary">
              Drop file to embed
            </div>
          </div>
        )}
        {isUploading && (
          <div className="absolute top-2 right-2 z-10 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            Uploading…
          </div>
        )}
        <div className="flex items-center gap-2 mb-4">
          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            className="flex-1 text-2xl font-bold font-display bg-transparent border-none outline-none placeholder:text-muted-foreground/40"
            disabled={note.is_trashed || note.is_external}
          />
          {!note.is_trashed && !note.is_external && (
            <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} tick={savedTick} />
          )}
          {!note.is_trashed && <ProcessingIndicator note={note} />}

          {note.entity_type && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {note.entity_type}
            </Badge>
          )}
          {note.is_external && note.source_app && (
            <Badge variant="outline" className="text-[10px] shrink-0 bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">
              {note.source_app}
            </Badge>
          )}
        </div>
        {/* Web clip snapshot — render at the top so it's the first thing the user sees */}
        {note.source_app === "singlefile" &&
          metadata &&
          typeof (metadata as Record<string, unknown>).web_clip === "object" &&
          (metadata as Record<string, unknown>).web_clip !== null && (
            <div className="mb-4 -mx-4">
              <WebClipPreview
                defaultOpen
                webClip={
                  (metadata as Record<string, unknown>).web_clip as {
                    url?: string | null;
                    hostname?: string | null;
                    snapshot_storage_path?: string | null;
                    snapshot_attachment?: string | null;
                  }
                }
              />
            </div>
          )}
        {sourceMode ? (
          <textarea
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
              pendingSaveContentRef.current = e.target.value;
              lastLocalContentRef.current = e.target.value;
              contentSaveTimer.current = setTimeout(() => {
                saveContentNow(e.target.value);
                triggerGitHubSync(note.id);
              }, 800);
            }}
            className="w-full flex-1 min-h-0 bg-transparent border-none outline-none resize-none font-mono text-sm text-foreground placeholder:text-muted-foreground/40"
            placeholder="Markdown source…"
            disabled={note.is_trashed || note.is_external}
          />
        ) : (
          <>
            <EditorContent editor={editor} className="tiptap-editor" />
            {editor && !isMobile && !note.is_trashed && !note.is_external && (
              <EditorBubbleMenu
                editor={editor}
                onInsertWikilink={() => {
                  const pos = editor.state.selection.from ?? 0;
                  handleOpenAutocomplete(pos);
                }}
              />
            )}
          </>
        )}
        {/* Media analysis overlay badges */}
        {!sourceMode && <MediaAnalysisOverlay noteId={note.id} editorContainerRef={editorContainerRef} />}
      </div>

      {/* Attachments & extracted content */}
      {!sourceMode && <NoteAttachmentsPanel noteId={note.id} />}


      {/* Connections panel */}
      {showConnections && (
        <div className="shrink-0 border-t border-border px-4 py-3 overflow-y-auto max-h-[40%] bg-muted/10">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-primary" /> Connections
            </h4>
            <button onClick={() => setShowConnections(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
          <ConnectionsPanel noteId={note.id} />
        </div>
      )}

      {/* External note panel — collapsed by default */}
      {note.is_external && (
        <details className="shrink-0 border-t border-border bg-muted/20 group">
          <summary className="px-4 py-2 cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground select-none flex items-center gap-1.5">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Data from {note.source_app || "external app"}
          </summary>
          <div className="px-4 pb-4 overflow-y-auto max-h-[30%]">
            <ExternalNotePanel note={note} />
          </div>
        </details>
      )}

      {/* Web clip snapshot now rendered at top of editor (see above title bar) */}


      {/* Note Metadata editor */}
      {!note.is_trashed && (
        <NoteMetadataEditor
          noteId={note.id}
          metadata={metadata}
          onUpdate={(updated) => {
            updateNote.mutate({ id: note.id, metadata: updated } as any);
          }}
          tags={note.tags || []}
          onAddTag={(tag) => {
            if (!note.tags?.includes(tag)) {
              updateNote.mutate({ id: note.id, tags: [...(note.tags || []), tag] });
            }
          }}
          onRemoveTag={removeTag}
          showTagInput={showTagInput}
        />
      )}


      {/* Outgoing links panel */}
      <OutgoingLinksPanel noteId={note.id} onNavigate={handleNavigateToNote} />
      {/* Backlinks panel */}
      <BacklinksPanel noteId={note.id} onNavigate={handleNavigateToNote} />

      {/* Suggested Links panel */}
      <SuggestedLinksPanel
        noteId={note.id}
        onInsertWikilink={(targetId, targetTitle) => {
          if (editor) {
            insertWikilinkSafely(editor, { noteId: targetId, noteTitle: targetTitle });
          }
        }}
      />



      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground shrink-0">
        <div className="flex items-center gap-2">
          <span>
            {updateNote.isPending ? "Saving…" : `Saved ${formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}`}
          </span>
          {ghConn?.sync_enabled && (
            <span className="flex items-center gap-1">
              {isSyncing && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {!isSyncing && syncStatus === "synced" && <CheckCircle2 className="h-2.5 w-2.5 text-success" />}
              {!isSyncing && syncStatus === "error" && (
                <span title={syncLog?.error_message || "Sync error"}>
                  <AlertCircle className="h-2.5 w-2.5 text-destructive" />
                </span>
              )}
              {!isSyncing && !syncStatus && <span className="text-muted-foreground/50">Not synced</span>}
            </span>
          )}
        </div>
        <span>{wordCount} words</span>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!duplicateTarget} onOpenChange={(open) => { if (!open) setDuplicateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Title already exists in this folder</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how Menerio should handle this duplicate title. GitHub filenames will always remain collision-safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between gap-2">
            <AlertDialogCancel onClick={() => { setTitle(note.title); lastLocalTitleRef.current = note.title ?? ""; pendingSaveTitleRef.current = null; setDuplicateTarget(null); }}>
              Rename
            </AlertDialogCancel>
            <Button variant="outline" onClick={mergeDuplicate}>Merge</Button>
            <AlertDialogAction onClick={keepDuplicateSafely}>Keep duplicate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The note will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={permanentDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ForwardToAppDialog open={showForwardDialog} onOpenChange={setShowForwardDialog} note={note} />

      {/* Wikilink autocomplete */}
      <WikilinkAutocomplete
        isOpen={wikilinkOpen}
        onClose={() => setWikilinkOpen(false)}
        onSelect={handleWikilinkSelect}
        onCreate={handleWikilinkCreate}
        position={wikilinkPos}
        excludeNoteId={note.id}
      />
    </div>
    {/* Version History Panel */}
    {showHistory && (
      <VersionHistoryPanel noteId={note.id} onClose={() => setShowHistory(false)} />
    )}
    {/* Local Graph Panel */}
    {showLocalGraph && (
      <LocalGraphPanel
        noteId={note.id}
        noteTitle={title}
        onNavigate={handleNavigateToNote}
        onClose={() => onToggleLocalGraph?.()}
        onLinkToNote={() => setShowLinkToNote(true)}
      />
    )}
    <LinkToNoteDialog
      open={showLinkToNote}
      onOpenChange={setShowLinkToNote}
      targetNoteId={note.id}
      targetNoteTitle={title}
    />
    <Dialog open={!!interactionGroupId} onOpenChange={(open) => { if (!open) setInteractionGroupId(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log this note as an interaction in {selectedInteractionGroup?.groupName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={interactionType} onValueChange={setInteractionType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Summary</Label>
            <input
              value={interactionSummary}
              onChange={(event) => setInteractionSummary(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInteractionGroupId(null)}>Cancel</Button>
          <Button onClick={logGroupInteraction}>Log Interaction</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {showChat && (
      <NoteChatPanel
        note={note}
        onClose={() => setShowChat(false)}
        onNoteChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["notes"] });
        }}
      />
    )}
    <ModerationBlockDialog
      isOpen={!!moderationBlock}
      onClose={() => setModerationBlock(null)}
      reason={moderationBlock?.reason}
      category={moderationBlock?.category}
      supportHint={moderationBlock?.support_hint}
    />
    </div>
  );
}

