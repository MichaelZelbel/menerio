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
import { Note, useUpdateNote, useDeleteNote, useProcessNote, useCreateNote } from "@/hooks/useNotes";
import { useSharedNote, useShareNote, useUnshareNote, useCopyShareLink } from "@/hooks/useNoteSharing";
import { useGitHubConnection, useGitHubSyncExport, useSyncLogForNote } from "@/hooks/useGitHubSync";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ExternalNotePanel } from "./ExternalNotePanel";
import { ForwardToAppDialog } from "./ForwardToAppDialog";
import { WikilinkAutocomplete } from "./WikilinkAutocomplete";
import { BacklinksPanel } from "./BacklinksPanel";
import { SuggestedLinksPanel } from "./SuggestedLinksPanel";
import { MediaAnalysisOverlay } from "./MediaAnalysisOverlay";
import { LocalGraphPanel } from "./LocalGraphPanel";
import { NoteMetadataEditor } from "./NoteMetadataEditor";
import { LinkToNoteDialog } from "./LinkToNoteDialog";
import { NoteChatPanel, type ChatMessage } from "./NoteChatPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAICreditsGate } from "@/hooks/useAICreditsGate";
import { useAuth } from "@/contexts/AuthContext";
import { EditorToolbar } from "./EditorToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal,
  Copy,
  RotateCcw,
  Tag,
  X,
  Info,
  CalendarPlus,
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
} from "lucide-react";
import { CreateEventDialog, EventDraft } from "./CreateEventDialog";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { formatDistanceToNow, format } from "date-fns";
import { showToast } from "@/lib/toast";
import { normalizeNoteContent } from "@/lib/note-content";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

const AUTO_PROCESS_DELAY = 10_000;
const MIN_WORDS_FOR_PROCESSING = 50;

interface NoteEditorProps {
  note: Note;
  onNoteDeleted?: () => void;
  showLocalGraph?: boolean;
  onToggleLocalGraph?: () => void;
}

/** Extract all wikilink noteIds from editor JSON content */
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

/** Sync manual_link connections based on wikilinks in content */
async function syncManualLinks(noteId: string, userId: string, linkedNoteIds: string[]) {
  try {
    // Get existing manual_link connections from this note
    const { data: existing } = await supabase
      .from("note_connections" as any)
      .select("id, target_note_id")
      .eq("source_note_id", noteId)
      .eq("connection_type", "manual_link")
      .eq("user_id", userId);

    const existingMap = new Map((existing || []).map((e: any) => [e.target_note_id, e.id]));
    const newTargets = new Set(linkedNoteIds);

    // Delete removed links
    const toDelete = (existing || [])
      .filter((e: any) => !newTargets.has(e.target_note_id))
      .map((e: any) => e.id);

    if (toDelete.length > 0) {
      await supabase.from("note_connections" as any).delete().in("id", toDelete);
    }

    // Upsert new links
    const toUpsert = linkedNoteIds
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

export function NoteEditor({ note, onNoteDeleted, showLocalGraph: showLocalGraphProp, onToggleLocalGraph }: NoteEditorProps) {
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const processNote = useProcessNote();
  const createNote = useCreateNote();
  const { checkCredits } = useAICreditsGate();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: ghConn } = useGitHubConnection();
  const ghSync = useGitHubSyncExport();
  const { data: syncLog } = useSyncLogForNote(note.id);
  const [title, setTitle] = useState(note.title);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [isExtractingEvent, setIsExtractingEvent] = useState(false);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const showLocalGraph = showLocalGraphProp ?? false;
  const [showLinkToNote, setShowLinkToNote] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  // Wikilink autocomplete state
  const [wikilinkOpen, setWikilinkOpen] = useState(false);
  const [wikilinkPos, setWikilinkPos] = useState<{ top: number; left: number } | null>(null);
  const wikilinkInsertPos = useRef<number | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const triggerGitHubSync = useCallback((noteId: string) => {
    if (!ghConn?.sync_enabled || !ghConn?.repo_owner || !ghConn?.repo_name) return;
    if (ghConn.sync_direction !== "export" && ghConn.sync_direction !== "bidirectional") return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      ghSync.mutate({ noteId, action: "update" });
    }, 3000);
  }, [ghConn, ghSync]);

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
    editor.commands.insertWikilink({ noteId, noteTitle: title });
    setWikilinkOpen(false);
  }, []);

  const handleWikilinkCreate = useCallback(async (title: string) => {
    if (!editor) return;
    try {
      const newNote = await createNote.mutateAsync({ title });
      editor.commands.insertWikilink({ noteId: newNote.id, noteTitle: title });
      setWikilinkOpen(false);
    } catch {
      showToast.error("Failed to create note");
    }
  }, [createNote]);

  const handleNavigateToNote = useCallback((noteId: string) => {
    navigate(`/dashboard/notes/${noteId}`);
  }, [navigate]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
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
      ImageExt,
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
    ],
    content: normalizeNoteContent(note.content),
    editable: !note.is_trashed && !note.is_external,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateNote.mutate({ id: note.id, content: html });
        triggerGitHubSync(note.id);

        // Sync manual_link connections
        if (user) {
          const doc = e.getJSON();
          const linkedIds = extractWikilinkIds(doc);
          syncManualLinks(note.id, user.id, linkedIds);
          queryClient.invalidateQueries({ queryKey: ["backlinks"] });
        }
      }, 800);

      // Schedule auto AI processing
      if (processTimer.current) clearTimeout(processTimer.current);
      processTimer.current = setTimeout(() => {
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

  // Sync when note changes
  useEffect(() => {
    // Save current chat messages for the previous note
    // (note.id has already changed, so we use a ref to track the previous)
    setTitle(note.title);
    setShowTagInput(false);
    setShowInfo(false);
    setSourceMode(false);
    // Restore chat messages for this note (or empty)
    setChatMessages(chatMessagesRef.current.get(note.id) || []);
    if (processTimer.current) clearTimeout(processTimer.current);
    const normalizedContent = normalizeNoteContent(note.content);
    if (editor && normalizedContent !== editor.getHTML()) {
      editor.commands.setContent(normalizedContent);
    }
    if (editor) {
      editor.setEditable(!note.is_trashed && !note.is_external);
    }
  }, [note.id]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNote.mutate({ id: note.id, title: val });
      triggerGitHubSync(note.id);
    }, 800);
  };

  const toggleFavorite = () => updateNote.mutate({ id: note.id, is_favorite: !note.is_favorite });
  const togglePin = () => updateNote.mutate({ id: note.id, is_pinned: !note.is_pinned });

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

  const extractEvent = async () => {
    const text = `${title}\n\n${editor?.getText() || ""}`.trim();
    if (!text || text.length < 10) { showToast.error("Note is too short to extract an event"); return; }
    setIsExtractingEvent(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-event", { body: { content: text } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setEventDraft(data.event as EventDraft);
      setShowEventDialog(true);
    } catch (err: any) {
      console.error("Event extraction failed:", err);
      showToast.error(err.message || "Failed to extract event from note");
    } finally {
      setIsExtractingEvent(false);
    }
  };

  const plainText = editor?.getText() || "";
  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
  const charCount = plainText.length;
  const metadata = note.metadata as Record<string, unknown> | null;
  const syncStatus = syncLog?.sync_status;
  const isSyncing = ghSync.isPending;

  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    if (!sourceMode) {
      // Rich → Source
      const md = (editor.storage as any).markdown?.getMarkdown?.() || editor.getHTML();
      setSourceText(md);
      setSourceMode(true);
    } else {
      // Source → Rich
      editor.commands.setContent(sourceText);
      // trigger save
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateNote.mutate({ id: note.id, content: editor.getHTML() });
        triggerGitHubSync(note.id);
      }, 800);
      setSourceMode(false);
    }
  }, [editor, sourceMode, sourceText, note.id, updateNote, triggerGitHubSync]);

  return (
    <div className="flex h-full">
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Action toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFavorite} title={note.is_favorite ? "Remove from favorites" : "Add to favorites"}>
          <Star className={cn("h-4 w-4", note.is_favorite && "fill-warning text-warning")} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePin} title={note.is_pinned ? "Unpin" : "Pin to top"}>
          <Pin className={cn("h-4 w-4", note.is_pinned && "text-primary")} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowTagInput(!showTagInput)} title="Add tag">
          <Tag className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowInfo(!showInfo)} title="Note info">
          <Info className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowConnections(!showConnections)} title="Find connections">
          <Link2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8", showLocalGraph && "bg-accent")} onClick={() => onToggleLocalGraph?.()} title="Local graph">
          <Network className="h-4 w-4" />
        </Button>
        {syncLog && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowHistory(!showHistory)} title="Version history">
            <GitCommit className="h-4 w-4" />
          </Button>
        )}
        {!note.is_trashed && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={extractEvent} disabled={isExtractingEvent} title="Create event in Temerio">
            {isExtractingEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
          </Button>
        )}
        {!note.is_trashed && !note.is_external && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowForwardDialog(true)} title="An App senden">
            <Send className="h-4 w-4" />
          </Button>
        )}
        {!note.is_trashed && !metadata?.type && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { if (checkCredits()) processNote.mutate(note.id); }} disabled={processNote.isPending} title="Extract metadata with AI">
            {processNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Classify
          </Button>
        )}

        {!note.is_trashed && !note.is_external && (
          <Button variant="ghost" size="icon" className={cn("h-8 w-8", sourceMode && "bg-accent text-accent-foreground")} onClick={toggleSourceMode} title={sourceMode ? "Rich text mode" : "Markdown source"}>
            <Code2 className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className={cn("h-8 w-8", showChat && "bg-accent text-accent-foreground")} onClick={() => setShowChat(!showChat)} title="AI Chat">
          <MessageSquare className="h-4 w-4" />
        </Button>

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={moveToTrash}>
                <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${title}\n\n${plainText}`); showToast.success("Copied to clipboard"); }}>
                <Copy className="mr-2 h-4 w-4" /> Copy to Clipboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/dashboard/notes/${note.id}`); showToast.copied(); }}>
                <Link2 className="mr-2 h-4 w-4" /> Copy Note Link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

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

      {/* Tags */}
      {(showTagInput || (note.tags && note.tags.length > 0)) && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border flex-wrap shrink-0">
          {note.tags?.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {showTagInput && (
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(); }
                if (e.key === "Escape") setShowTagInput(false);
              }}
              placeholder="Add tag…"
              className="h-6 w-24 text-xs border-none shadow-none focus-visible:ring-0 px-1"
              autoFocus
            />
          )}
        </div>
      )}

      {/* Rich text formatting toolbar */}
      {!note.is_trashed && !sourceMode && <EditorToolbar editor={editor} />}

      {/* Smart Tags / Metadata editor */}
      {!note.is_trashed && (
        <NoteMetadataEditor
          metadata={metadata}
          onUpdate={(updated) => {
            updateNote.mutate({ id: note.id, metadata: updated } as any);
          }}
        />
      )}

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
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            className="flex-1 text-2xl font-bold font-display bg-transparent border-none outline-none placeholder:text-muted-foreground/40"
            disabled={note.is_trashed || note.is_external}
          />
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
        {sourceMode ? (
          <textarea
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => {
                updateNote.mutate({ id: note.id, content: e.target.value });
                triggerGitHubSync(note.id);
              }, 800);
            }}
            className="w-full flex-1 min-h-0 bg-transparent border-none outline-none resize-none font-mono text-sm text-foreground placeholder:text-muted-foreground/40"
            placeholder="Markdown source…"
            disabled={note.is_trashed || note.is_external}
          />
        ) : (
          <EditorContent editor={editor} className="tiptap-editor" />
        )}
        {/* Media analysis overlay badges */}
        {!sourceMode && <MediaAnalysisOverlay noteId={note.id} editorContainerRef={editorContainerRef} />}
      </div>

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

      {/* External note panel */}
      {note.is_external && (
        <div className="shrink-0 border-t border-border px-4 py-4 overflow-y-auto max-h-[40%] bg-muted/20">
          <ExternalNotePanel note={note} />
        </div>
      )}

      {/* Backlinks panel */}
      <BacklinksPanel noteId={note.id} onNavigate={handleNavigateToNote} />

      {/* Suggested Links panel */}
      <SuggestedLinksPanel
        noteId={note.id}
        onInsertWikilink={(targetId, targetTitle) => {
          if (editor) {
            editor.commands.insertWikilink({ noteId: targetId, noteTitle: targetTitle });
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

      <CreateEventDialog open={showEventDialog} onOpenChange={setShowEventDialog} draft={eventDraft} />
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
    {showChat && (
      <NoteChatPanel
        note={note}
        onClose={() => setShowChat(false)}
        messages={chatMessages}
        onMessagesChange={(msgs) => {
          setChatMessages(msgs);
          chatMessagesRef.current.set(note.id, msgs);
        }}
        onNoteChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["notes"] });
          if (editor) {
            supabase
              .from("notes" as any)
              .select("content, tags, metadata")
              .eq("id", note.id)
              .single()
              .then(({ data }) => {
                if (data) {
                  const normalized = normalizeNoteContent((data as any).content);
                  if (normalized !== editor.getHTML()) {
                    editor.commands.setContent(normalized);
                  }
                }
              });
          }
        }}
      />
    )}
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
