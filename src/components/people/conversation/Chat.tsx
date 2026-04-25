import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatInput, type ChatAttachment } from "./ChatInput";
import { ChatMessages, type ChatMessage } from "./ChatMessages";

interface ChatProps {
  personId: string;
  personName: string;
  conversationContext: { context: string; intent: string; presetTone: string; customTone: string };
}

export function Chat({ personId, personName, conversationContext }: ChatProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadHistory = async () => {
      setLoadingHistory(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setLoadingHistory(false);
      const { data } = await supabase
        .from("conversation_messages" as any)
        .select("role, content")
        .eq("user_id", user.id)
        .eq("person_id", personId)
        .order("created_at", { ascending: true });
      setMessages(data?.length ? data as unknown as ChatMessage[] : [{ role: "assistant", content: `Hi — I'm Mira. I can help you think through conversations, memories, and context around ${personName}.` }]);
      setLoadingHistory(false);
    };
    loadHistory();
  }, [personId, personName]);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => { const timer = setTimeout(scrollToBottom, 50); return () => clearTimeout(timer); }, [messages, loading, scrollToBottom]);

  const sendMessage = async () => {
    if (loading || (!input.trim() && attachments.length === 0)) return;
    const userMessage = input.trim() || `Please review the attached document${attachments.length > 1 ? "s" : ""}.`;
    const currentAttachments = attachments;
    setInput("");
    setAttachments([]);
    setMessages((prev) => [...prev, { role: "user", content: userMessage, attachments: currentAttachments.map(({ name, size }) => ({ name, size })) }]);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in again.");
      const { data, error } = await supabase.functions.invoke("conversation-chat", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { message: userMessage, personId, conversationContext, attachments: currentAttachments.map(({ name, content }) => ({ name, content })) },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Mira could not reply.");
      setMessages((prev) => [...prev, { role: "assistant", content: (data as any).reply }]);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Chat failed", description: error?.message || "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <Card className="flex h-[620px] flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Mira with {personName}</CardTitle>
        <Button variant="ghost" size="icon" onClick={() => setFullscreen((value) => !value)}>
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <ScrollArea ref={scrollRef} className="min-h-0 flex-1 pr-4"><ChatMessages messages={messages} loading={loading} loadingHistory={loadingHistory} /></ScrollArea>
        <div className="border-t pt-3"><ChatInput input={input} setInput={setInput} onSend={sendMessage} loading={loading} attachments={attachments} onAddAttachment={(a) => setAttachments((prev) => [...prev, a])} onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} /></div>
      </CardContent>
    </Card>
  );

  return <>{content}<Dialog open={fullscreen} onOpenChange={setFullscreen}><DialogContent className="max-w-5xl p-0">{content}</DialogContent></Dialog></>;
}
