import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Note } from "@/hooks/useNotes";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Send,
  Loader2,
  Bot,
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

export interface NoteChatPanelProps {
  note: Note;
  onClose: () => void;
  onNoteChanged: () => void;
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[]) => void;
}

export function NoteChatPanel({ note, onClose, onNoteChanged, messages, onMessagesChange }: NoteChatPanelProps) {
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
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
    onMessagesChange(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      // Build conversation for the API (only role + content)
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error: fnErr } = await supabase.functions.invoke(
        "note-chat",
        {
          body: { note_id: note.id, messages: apiMessages },
        }
      );

      if (fnErr) {
        // Preview environment can interfere with edge function requests
        const msg = fnErr.message || "Chat request failed";
        if (msg.includes("Failed to send") || msg.includes("FunctionsFetchError")) {
          throw new Error("Edge function call failed. This may work on the published URL — try publishing first.");
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
      setMessages((prev) => [...prev, assistantMsg]);

      // If any tool modified the note, notify parent to refresh
      const modifyingTools = [
        "append_to_note",
        "update_note_metadata",
        "update_note_tags",
        "add_wikilink",
      ];
      if (
        data.tool_results?.some((tr: any) =>
          modifyingTools.includes(tr.tool)
        )
      ) {
        onNoteChanged();
      }

      // Refresh credits display
      triggerCreditsRefresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, session, messages, note.id, onNoteChanged]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full w-80 border-l border-border bg-background z-[60]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Chat</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
            <Bot className="h-8 w-8 mx-auto opacity-40" />
            <p>Ask me anything about this note or your knowledge base.</p>
            <p className="text-[10px]">
              I can search your notes, add content, update tags & metadata, and
              create links.
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

              {/* Tool results indicator */}
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
      <div className="p-3 pb-20 border-t border-border shrink-0">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this note…"
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
      </div>
    </div>
  );
}
