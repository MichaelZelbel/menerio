import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { triggerCreditsRefresh } from "@/lib/credits-events";
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
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolResults?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
}

export function GlobalAIChatFAB() {
  const { user, session } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevContextRef = useRef<string>("");

  // Detect note context
  const noteId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/notes\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const contextKey = noteId || "general";

  // Reset messages when context changes
  useEffect(() => {
    if (prevContextRef.current && prevContextRef.current !== contextKey) {
      setMessages([]);
      setError(null);
    }
    prevContextRef.current = contextKey;
  }, [contextKey]);

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
  }, [messages, isLoading]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !session) return;

    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error: fnErr } = await supabase.functions.invoke(
        "note-chat",
        {
          body: {
            note_id: noteId || undefined,
            messages: apiMessages,
          },
        }
      );

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
      setMessages([...newMessages, assistantMsg]);
      triggerCreditsRefresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, session, messages, noteId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
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
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          )}
          title="AI Chat (⌘⇧K)"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {/* Overlay */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-48px))] animate-in slide-in-from-bottom-4 fade-in duration-200">
            <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ height: "min(500px, calc(100vh - 80px))" }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">
                    {noteId ? "Note AI Chat" : "Knowledge Base Chat"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">⌘⇧K</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
                    <Bot className="h-8 w-8 mx-auto opacity-40" />
                    <p>{emptyText}</p>
                    <p className="text-[10px]">
                      I can search your notes, media, and knowledge graph.
                    </p>
                  </div>
                )}

                {messages.map((msg, i) => (
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
                <p className="text-[10px] text-muted-foreground mt-1.5">⌘↵ to send</p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
