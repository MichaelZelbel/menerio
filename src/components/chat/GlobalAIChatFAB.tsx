import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildApiMessages,
  CHAT_WINDOW_SIZE,
  SUMMARY_THRESHOLD,
  NOTE_MODIFYING_TOOLS,
  type PersistedChatMessage,
  type PersistedChatState,
} from "@/lib/chat-history";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Bot,
  X,
  Send,
  Loader2,
  User,
  Wrench,
  AlertCircle,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

type ChatMessage = PersistedChatMessage;

export function GlobalAIChatFAB() {
  const { user, session } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect note context from the current route
  const noteId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/notes\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const contextKey = noteId ? `note:${noteId}` : "general";

  // Persisted chat state for the current context
  const [state, setState] = useState<PersistedChatState>(() =>
    loadChatState(user?.id, contextKey),
  );

  // Re-hydrate when context (note or general) changes
  useEffect(() => {
    setState(loadChatState(user?.id, contextKey));
    setError(null);
  }, [contextKey, user?.id]);

  // Persist on every change
  useEffect(() => {
    saveChatState(user?.id, contextKey, state);
  }, [state, contextKey, user?.id]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus textarea when opened
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, isLoading]);

  const refreshSummaryIfNeeded = useCallback(
    async (current: PersistedChatState): Promise<PersistedChatState> => {
      const olderCount = current.messages.length - CHAT_WINDOW_SIZE;
      if (olderCount < SUMMARY_THRESHOLD - CHAT_WINDOW_SIZE) return current;
      if (current.summarizedUpTo >= current.messages.length - CHAT_WINDOW_SIZE) return current;
      try {
        const olderMessages = current.messages.slice(0, current.messages.length - CHAT_WINDOW_SIZE);
        const transcript = olderMessages.map((m) => ({ role: m.role, content: m.content }));
        const { data } = await supabase.functions.invoke("note-chat", {
          body: { mode: "summarize", messages: transcript },
        });
        if (data?.summary) {
          return {
            ...current,
            summary: data.summary,
            summarizedUpTo: current.messages.length - CHAT_WINDOW_SIZE,
          };
        }
      } catch {
        // ignore — summary is best-effort
      }
      return current;
    },
    [],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !session) return;

    setError(null);
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
      const { data, error: fnErr } = await supabase.functions.invoke("note-chat", {
        body: {
          note_id: noteId || undefined,
          messages: apiMessages,
        },
      });

      if (fnErr) {
        const msg = fnErr.message || "Chat request failed";
        if (msg.includes("Failed to send") || msg.includes("FunctionsFetchError")) {
          throw new Error("Edge function call failed. Try publishing first.");
        }
        throw new Error(msg);
      }

      if (data?.error) {
        if (data.error === "Insufficient AI credits") {
          setError("You're out of AI credits for this period.");
        } else {
          throw new Error(data.error);
        }
        return;
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.reply || "",
        toolResults: data.tool_results,
      };
      let updated: PersistedChatState = {
        ...nextState,
        messages: [...nextState.messages, assistantMsg],
      };

      // If a note-modifying tool ran, refresh the editor live + invalidate queries
      if (
        noteId &&
        data.tool_results?.some((tr: any) => NOTE_MODIFYING_TOOLS.includes(tr.tool))
      ) {
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        window.dispatchEvent(
          new CustomEvent("menerio:note-updated", { detail: { noteId } }),
        );
      }

      updated = await refreshSummaryIfNeeded(updated);
      setState(updated);

      triggerCreditsRefresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, session, state, noteId, queryClient, refreshSummaryIfNeeded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = () => {
    if (!confirm("Clear this conversation?")) return;
    clearChatState(user?.id, contextKey);
    setState({ messages: [], summary: "", summarizedUpTo: 0 });
    setError(null);
  };

  if (!user) return null;

  const emptyText = noteId
    ? "Ask me about this note or your knowledge base."
    : "Ask me anything about your knowledge base.";

  return (
    <>
      {/* FAB button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center justify-center",
            "h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg",
            "hover:bg-primary/90 transition-all hover:scale-105 active:scale-95",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
          )}
          title="AI Chat (⌘⇧K)"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {/* Docked chat panel — non-blocking, no backdrop, note stays visible */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-48px))] animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div
            className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
            style={{ height: "min(500px, calc(100vh - 80px))" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {noteId ? "Editing current note" : "Knowledge Base"}
                </span>
                {state.messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    · {state.messages.length} msgs{state.summary ? " · summary" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground hidden sm:inline">⌘⇧K</span>
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
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
              {state.messages.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
                  <Bot className="h-8 w-8 mx-auto opacity-40" />
                  <p>{emptyText}</p>
                  <p className="text-[10px]">
                    I can search your notes, media, and knowledge graph.
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
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
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
            <div className="p-3 border-t border-border shrink-0">
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask something…"
                  className="min-h-[40px] max-h-[120px] resize-none text-sm"
                  rows={1}
                  disabled={isLoading}
                />
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">⌘↵ to send · history saved</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
