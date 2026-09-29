import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { Note } from "@/hooks/useNotes";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { summarizeChat } from "@/lib/chat-summary";
import { dbErrorMessage, functionErrorMessage, OUT_OF_CREDITS_MESSAGE } from "@/lib/function-error";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildApiMessages,
  withSummary,
  NOTE_MODIFYING_TOOLS,
  NOTE_CREATING_TOOLS,
  type PersistedChatMessage,
  type PersistedChatState,
} from "@/lib/chat-history";
import {
  flushNoteSave,
  hashNoteContent,
  applyNoteEdit,
  applyNoteEditVerified,

  type NoteEditPayload,
} from "@/lib/note-ai-edit";
import {
  X,
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
  AlertCircle,
  Trash2,
  Undo2,
  FilePlus2,
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

export type ChatMessage = PersistedChatMessage;

export interface NoteChatPanelProps {
  note: Note;
  onClose: () => void;
  onNoteChanged: () => void;
}

export function NoteChatPanel({ note, onClose, onNoteChanged }: NoteChatPanelProps) {
  const { session, user } = useAuth();
  const contextKey = `note:${note.id}`;
  const [state, setState] = useState<PersistedChatState>(() =>
    loadChatState(user?.id, contextKey),
  );
  const [input, setInput] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate from localStorage when the note (context) changes
  useEffect(() => {
    setState(loadChatState(user?.id, contextKey));
    setError(null);
  }, [contextKey, user?.id]);

  // Persist on every change
  useEffect(() => {
    saveChatState(user?.id, contextKey, state);
  }, [state, contextKey, user?.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, isLoading]);

  // The panel lives inside the note's editor, which is replaced when another
  // note opens. A reply that arrives after that was set on an unmounted
  // component and lost; it now goes into this note's saved history instead.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const summarizingRef = useRef(false);

  const deliver = useCallback(
    (userId: string | undefined, ctx: string, next: PersistedChatState) => {
      if (mountedRef.current) setState(next);
      else saveChatState(userId, ctx, next);
    },
    [],
  );

  /** Fold older turns into the summary after the reply is shown, without holding it back. */
  const summarizeLater = useCallback((userId: string | undefined, ctx: string, from: PersistedChatState) => {
    if (summarizingRef.current) return;
    summarizingRef.current = true;
    void summarizeChat("note-chat", from)
      .then((res) => {
        if (!res) return;
        if (mountedRef.current) setState((prev) => withSummary(prev, res.summary, res.upTo, res.messageCount));
        else saveChatState(userId, ctx, withSummary(loadChatState(userId, ctx), res.summary, res.upTo, res.messageCount));
      })
      .finally(() => {
        summarizingRef.current = false;
      });
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !session) return;

    setError(null);
    const sentUserId = user?.id;
    const sentContext = contextKey;
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextState: PersistedChatState = {
      ...state,
      messages: [...state.messages, userMsg],
    };
    setState(nextState);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages = buildApiMessages(nextState);
      // Persist any pending autosave first, then tell the agent which version
      // it is editing. If the note changed underneath, its edit tools refuse
      // rather than overwrite.
      const flushed = await flushNoteSave(note.id);
      const { data, error: fnErr } = await supabase.functions.invoke("note-chat", {
        body: {
          note_id: note.id,
          base_updated_at: flushed.updatedAt,
          base_content_hash: hashNoteContent(flushed.content ?? note.content ?? ""),
          messages: apiMessages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      // A non-2xx answer (out of credits is a 402) arrives as fnErr with
      // data null, so the reason is read from the answer itself.
      if (fnErr) {
        throw new Error(await functionErrorMessage(fnErr, "The assistant could not answer. Please try again."));
      }

      if (data?.error) {
        throw new Error(
          data.error === "Insufficient AI credits" || data.code === "INSUFFICIENT_CREDITS"
            ? OUT_OF_CREDITS_MESSAGE
            : "The assistant could not answer. Please try again.",
        );
      }

      const noteEdit: NoteEditPayload | null = data.note_edit ?? null;
      const notesCreated: ChatMessage["notesCreated"] = Array.isArray(data.notes_created)
        ? data.notes_created
        : undefined;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.reply || "",
        toolResults: data.tool_results,
        ...(notesCreated?.length ? { notesCreated } : {}),
        ...(noteEdit
          ? {
              noteEdit: {
                noteId: note.id,
                previousContent: noteEdit.previous_content ?? null,
              },
            }
          : {}),
      };
      const updated: PersistedChatState = {
        ...nextState,
        messages: [...nextState.messages, assistantMsg],
      };

      // If any tool modified the note, notify parent + the editor. When the
      // function returned the resulting content, hand it over directly so the
      // editor never has to refetch (or ignore) the change.
      if (
        noteEdit ||
        data.tool_results?.some((tr: any) => NOTE_MODIFYING_TOOLS.includes(tr.tool))
      ) {
        onNoteChanged();
        const applyResult = await applyNoteEditVerified(
          note.id,
          noteEdit?.content ?? null,
          noteEdit?.updated_at ?? null,
        );
        if (applyResult.status === "failed") {
          setError(
            "Saved. The editor view may be out of date. Reload the note to see the change.",
          );

        }
      }


      // A note created from here is a different note than the open one, so the
      // list and folder tree need to refetch even though the editor is fine.
      if (
        notesCreated?.length ||
        data.folders_created?.length ||
        data.tool_results?.some((tr: any) => NOTE_CREATING_TOOLS.includes(tr.tool))
      ) {
        onNoteChanged();
      }

      deliver(sentUserId, sentContext, updated);
      // Roll the summary forward when needed, after the reply is on screen.
      summarizeLater(sentUserId, sentContext, updated);

      triggerCreditsRefresh();
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || "Something went wrong");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [input, isLoading, session, state, note.id, note.content, onNoteChanged, user?.id, contextKey, deliver, summarizeLater]);

  /** Restore the note to the version from before an AI edit. */
  const undoNoteEdit = useCallback(
    async (previousContent: string | null) => {
      if (previousContent === null) return;
      if (!(await confirm({ title: "Undo this AI edit?", description: "The note goes back to how it was before this edit. Anything written since then is replaced.", confirmLabel: "Restore" }))) return;
      const { data, error: updErr } = await supabase
        .from("notes")
        .update({ content: previousContent })
        .eq("id", note.id)
        .select("updated_at")
        .single();
      if (updErr) {
        setError(dbErrorMessage(updErr, "Could not restore the earlier version. Please try again."));
        return;
      }
      onNoteChanged();
      applyNoteEdit(note.id, previousContent, (data as any)?.updated_at ?? null);
    },
    [note.id, onNoteChanged, confirm],
  );


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = async () => {
    if (!(await confirm({ title: "Clear this conversation?", description: "The messages are removed from this chat. Changes already made to your data stay.", confirmLabel: "Clear", destructive: true }))) return;
    clearChatState(user?.id, contextKey);
    setState({ messages: [], summary: "", summarizedUpTo: 0 });
    setError(null);
  };

  return (
    <div className="flex flex-col h-full w-80 border-l border-border bg-background z-[60]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Chat</span>
          {state.messages.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {state.messages.length} msgs{state.summary ? " · summary" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state.messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClear}
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button aria-label="Close chat"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
        {state.messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
            <Bot className="h-8 w-8 mx-auto opacity-40" />
            <p>Ask me anything about this note or your knowledge base.</p>
            <p className="text-[10px]">
              I can search your notes, add content, update tags & metadata, and
              create links.
            </p>
          </div>
        )}

        {state.messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            )}
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1 [&>p:last-child]:mb-0">
                  <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={chatMarkdownComponents}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}

              {msg.toolResults && msg.toolResults.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {msg.toolResults.map((tr, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                    >
                      <Wrench className="h-3 w-3" />
                      <span className="font-mono">
                        {tr.tool.replace(/_/g, " ")}
                      </span>
                      {(tr.result as any)?.success && (
                        <span className="text-primary">✓</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {msg.notesCreated && msg.notesCreated.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {msg.notesCreated.map((n) => (
                    <Link
                      key={n.id}
                      to={`/dashboard/notes/${n.id}`}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {n.title || "Untitled"}
                        {n.folder_path ? ` · ${n.folder_path}` : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {msg.noteEdit && msg.noteEdit.previousContent !== null && (
                <button
                  type="button"
                  onClick={() => undoNoteEdit(msg.noteEdit!.previousContent)}
                  className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  <Undo2 className="h-3 w-3" />
                  Undo this note edit
                </button>
              )}

            </div>
            {msg.role === "user" && (
              <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary shrink-0" />
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 pb-20 border-t border-border shrink-0">
        <div className="flex gap-2">
          <Textarea aria-label="Message"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this note…"
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isLoading}
          />
          <Button aria-label="Send message"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
