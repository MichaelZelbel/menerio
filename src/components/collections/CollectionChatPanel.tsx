import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { summarizeChat } from "@/lib/chat-summary";
import { functionErrorMessage, OUT_OF_CREDITS_MESSAGE } from "@/lib/function-error";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildApiMessages,
  withSummary,
  COLLECTION_MODIFYING_TOOLS,
  type PersistedChatMessage,
  type PersistedChatState,
} from "@/lib/chat-history";
import { X, Send, Loader2, Bot, User, Wrench, AlertCircle, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

export interface CollectionChatPanelProps {
  collectionId: string;
  collectionName: string;
  /** Optional — when set, chat has "current item" context. */
  itemId?: string | null;
  onClose: () => void;
  onCollectionChanged: () => void;
}

export function CollectionChatPanel({
  collectionId,
  collectionName,
  itemId,
  onClose,
  onCollectionChanged,
}: CollectionChatPanelProps) {
  const { session, user } = useAuth();
  const contextKey = itemId
    ? `collection:${collectionId}:item:${itemId}`
    : `collection:${collectionId}`;
  const [state, setState] = useState<PersistedChatState>(() => loadChatState(user?.id, contextKey));
  const [input, setInput] = useState("");
  const [confirm, confirmDialog] = useConfirmDialog();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setState(loadChatState(user?.id, contextKey));
    setError(null);
  }, [contextKey, user?.id]);

  useEffect(() => {
    saveChatState(user?.id, contextKey, state);
  }, [state, contextKey, user?.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state.messages, isLoading]);

  // The conversation a reply belongs to. The panel stays open while the user
  // moves between items; applying a late reply to whichever item is open by
  // then overwrote that item's saved chat and lost the reply for the one that
  // asked. A reply for another item (or after the panel closed) goes into that
  // item's saved history instead.
  const chatKey = `${user?.id ?? "anon"}|${contextKey}`;
  const chatKeyRef = useRef<string | null>(chatKey);
  useEffect(() => {
    chatKeyRef.current = chatKey;
    return () => {
      chatKeyRef.current = null;
    };
  }, [chatKey]);
  const summarizingRef = useRef(false);

  const deliver = useCallback((key: string, userId: string | undefined, ctx: string, next: PersistedChatState) => {
    if (chatKeyRef.current === key) setState(next);
    else saveChatState(userId, ctx, next);
  }, []);

  /** Fold older turns into the summary after the reply is shown, without holding it back. */
  const summarizeLater = useCallback((key: string, userId: string | undefined, ctx: string, from: PersistedChatState) => {
    if (summarizingRef.current) return;
    summarizingRef.current = true;
    void summarizeChat("collection-chat", from)
      .then((res) => {
        if (!res) return;
        if (chatKeyRef.current === key) setState((prev) => withSummary(prev, res.summary, res.upTo, res.messageCount));
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
    const sentKey = chatKey;
    const sentUserId = user?.id;
    const sentContext = contextKey;
    const userMsg: PersistedChatMessage = { role: "user", content: text };
    const nextState: PersistedChatState = { ...state, messages: [...state.messages, userMsg] };
    setState(nextState);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages = buildApiMessages(nextState);
      const { data, error: fnErr } = await supabase.functions.invoke("collection-chat", {
        body: {
          collection_id: collectionId,
          item_id: itemId ?? null,
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

      const assistantMsg: PersistedChatMessage = {
        role: "assistant",
        content: data.reply || "",
        toolResults: data.tool_results,
      };
      const updated: PersistedChatState = {
        ...nextState,
        messages: [...nextState.messages, assistantMsg],
      };

      if (data.tool_results?.some((tr: { tool: string }) => COLLECTION_MODIFYING_TOOLS.includes(tr.tool))) {
        onCollectionChanged();
      }

      deliver(sentKey, sentUserId, sentContext, updated);
      summarizeLater(sentKey, sentUserId, sentContext, updated);
      triggerCreditsRefresh();
    } catch (err) {
      if (chatKeyRef.current === sentKey) setError((err as Error).message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, session, state, collectionId, itemId, onCollectionChanged, chatKey, contextKey, user?.id, deliver, summarizeLater]);

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
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">
            {itemId ? `${collectionName} · item` : collectionName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {state.messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClear} title="Clear conversation">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button aria-label="Close chat" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
        {state.messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
            <Bot className="h-8 w-8 mx-auto opacity-40" />
            <p>Ask about this collection, or say things like:</p>
            <ul className="text-[11px] list-none space-y-1">
              <li>“Add an item from this URL: …”</li>
              <li>“List the 5 most recent items.”</li>
              <li>“Fill the missing fields on this item.”</li>
            </ul>
          </div>
        )}

        {state.messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />}
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1 [&>p:last-child]:mb-0">
                  <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={chatMarkdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}

              {msg.toolResults && msg.toolResults.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {msg.toolResults.map((tr, j) => (
                    <div key={j} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Wrench className="h-3 w-3" />
                      <span className="font-mono">{tr.tool.replace(/_/g, " ")}</span>
                      {(tr.result as { success?: boolean })?.success && <span className="text-primary">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {msg.role === "user" && <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
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

      <div className="p-3 pb-20 border-t border-border shrink-0">
        <div className="flex gap-2">
          <Textarea aria-label="Message"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={itemId ? "Ask about this item…" : "Ask about this collection…"}
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isLoading}
          />
          <Button aria-label="Send message" size="icon" className="h-10 w-10 shrink-0" onClick={sendMessage} disabled={!input.trim() || isLoading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
