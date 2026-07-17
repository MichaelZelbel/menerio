import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildApiMessages,
  CHAT_WINDOW_SIZE,
  SUMMARY_THRESHOLD,
  NOTE_MODIFYING_TOOLS,
  COLLECTION_MODIFYING_TOOLS,
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
  Maximize2,
  Minimize2,
  Expand,
  Shrink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

type ChatMessage = PersistedChatMessage;
type SizeMode = "docked" | "expanded" | "fullscreen";

const SIZE_STORAGE_KEY = "menerio:chat-fab-size";

function loadSizeMode(): SizeMode {
  if (typeof window === "undefined") return "docked";
  const v = window.localStorage.getItem(SIZE_STORAGE_KEY);
  return v === "expanded" || v === "fullscreen" ? v : "docked";
}

export function GlobalAIChatFAB() {
  const { user, session } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeMode, setSizeModeState] = useState<SizeMode>(() => loadSizeMode());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setSizeMode = useCallback((m: SizeMode) => {
    setSizeModeState(m);
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, m);
    } catch {
      // ignore
    }
  }, []);

  // Force docked on mobile (expanded == docked visually there)
  const effectiveMode: SizeMode = isMobile && sizeMode === "expanded" ? "docked" : sizeMode;

  // Detect note context from the current route
  const noteId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/notes\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Detect person context (People profile page) so the assistant knows whose
  // profile the user is looking at
  const personId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/people\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Detect collection context from /collections/:slug (and optional item route)
  const collectionSlug = useMemo(() => {
    const match = location.pathname.match(/^\/collections\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const [collectionId, setCollectionId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!collectionSlug || !user) {
      setCollectionId(null);
      return;
    }
    supabase
      .from("collections")
      .select("id")
      .eq("slug", collectionSlug)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCollectionId(data?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionSlug, user?.id]);

  const contextKey = collectionId
    ? `collection:${collectionId}`
    : noteId
      ? `note:${noteId}`
      : personId
        ? `person:${personId}`
        : "general";

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

  // Keyboard shortcut: Cmd/Ctrl+Shift+K; Escape steps size down before closing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape" && open) {
        if (effectiveMode === "fullscreen") {
          setSizeMode(isMobile ? "docked" : "expanded");
        } else if (effectiveMode === "expanded") {
          setSizeMode("docked");
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, effectiveMode, isMobile, setSizeMode]);

  // Focus textarea when opened
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-scroll to the newest message. Runs on new messages, while loading,
  // AND when the panel is (re)opened or resized — reopening remounts the
  // scroll container at the top, so without `open`/`effectiveMode` here you'd
  // land on the first message and have to scroll down manually. The rAF waits
  // for layout (and markdown/images) to settle before pinning to the bottom.
  useEffect(() => {
    if (!open) return;
    const pinToBottom = () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    };
    pinToBottom();
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [state.messages, isLoading, open, effectiveMode]);

  const refreshSummaryIfNeeded = useCallback(
    async (current: PersistedChatState): Promise<PersistedChatState> => {
      const olderCount = current.messages.length - CHAT_WINDOW_SIZE;
      if (olderCount < SUMMARY_THRESHOLD - CHAT_WINDOW_SIZE) return current;
      if (current.summarizedUpTo >= current.messages.length - CHAT_WINDOW_SIZE) return current;
      try {
        const olderMessages = current.messages.slice(0, current.messages.length - CHAT_WINDOW_SIZE);
        const transcript = olderMessages.map((m) => ({ role: m.role, content: m.content }));
        const chatFn = collectionId ? "collection-chat" : "note-chat";
        const { data } = await supabase.functions.invoke(chatFn, {
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
          person_id: personId || undefined,
          messages: apiMessages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
  }, [input, isLoading, session, state, noteId, personId, queryClient, refreshSummaryIfNeeded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends; Shift+Enter inserts a newline. This matches the in-note and
    // Mira chats and the usual convention (ChatGPT/Claude/etc.). Cmd/Ctrl+Enter
    // still sends too, since it has no Shift — so the old shortcut keeps working.
    if (e.key === "Enter" && !e.shiftKey) {
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
    : personId
      ? "Ask me about this person or anything in your knowledge base."
      : "Ask me anything about your notes, people, and media.";

  // Dimensions per mode
  const isLarge = effectiveMode !== "docked";
  const panelStyle: React.CSSProperties =
    effectiveMode === "fullscreen"
      ? {
          top: 16,
          right: 16,
          bottom: 16,
          left: 16,
          width: "auto",
          height: "auto",
        }
      : effectiveMode === "expanded"
        ? {
            bottom: 24,
            right: 24,
            width: "min(720px, calc(100vw - 48px))",
            height: "min(85dvh, calc(100dvh - 80px))",
          }
        : {
            bottom: 24,
            right: 24,
            width: isMobile ? "calc(100vw - 24px)" : "min(420px, calc(100vw - 48px))",
            height: "min(560px, calc(100dvh - 80px))",
          };

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

      {/* Optional backdrop in fullscreen for focus */}
      {open && effectiveMode === "fullscreen" && (
        <div
          className="fixed inset-0 z-40 bg-background/40 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setSizeMode(isMobile ? "docked" : "expanded")}
        />
      )}

      {/* Docked / expanded / fullscreen panel */}
      {open && (
        <div
          className="fixed z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
          style={panelStyle}
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {noteId ? "Editing current note" : "AI Assistant"}
                </span>
                {state.messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    · {state.messages.length} msgs{state.summary ? " · summary" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground hidden sm:inline mr-1">⌘⇧K</span>
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
                {!isMobile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setSizeMode(effectiveMode === "docked" ? "expanded" : "docked")}
                    title={effectiveMode === "docked" ? "Expand" : "Collapse"}
                  >
                    {effectiveMode === "docked" ? (
                      <Maximize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Minimize2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    setSizeMode(
                      effectiveMode === "fullscreen" ? (isMobile ? "docked" : "expanded") : "fullscreen",
                    )
                  }
                  title={effectiveMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
                >
                  {effectiveMode === "fullscreen" ? (
                    <Shrink className="h-3.5 w-3.5" />
                  ) : (
                    <Expand className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} title="Close">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className={cn(
                "flex-1 overflow-y-auto min-h-0 space-y-3",
                isLarge ? "px-5 py-4" : "p-3",
              )}
            >
              {state.messages.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
                  <Bot className="h-8 w-8 mx-auto opacity-40" />
                  <p>{emptyText}</p>
                  <p className="text-[10px]">
                    I can search your notes and media, and look up people's profiles.
                  </p>
                </div>
              )}

              {state.messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground max-w-[85%]"
                        : cn(
                            "bg-muted",
                            isLarge ? "max-w-[85%] md:max-w-[75ch]" : "max-w-[85%]",
                          ),
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
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
            <div className={cn("border-t border-border shrink-0", isLarge ? "p-4" : "p-3")}>
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask something…"
                  className={cn(
                    "min-h-[40px] resize-none text-sm",
                    isLarge ? "max-h-[200px]" : "max-h-[120px]",
                  )}
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
