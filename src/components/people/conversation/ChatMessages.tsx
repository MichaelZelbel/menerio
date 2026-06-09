import ReactMarkdown from "react-markdown";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; size: number }[];
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  loading: boolean;
  loadingHistory: boolean;
}

export function ChatMessages({ messages, loading, loadingHistory }: ChatMessagesProps) {
  if (loadingHistory) return <div className="py-8 text-center text-sm text-muted-foreground">Loading chat history…</div>;
  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
          <div className={cn("max-w-[85%] rounded-lg px-4 py-2 text-sm", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
            {message.attachments && (
              <div className="mb-2 flex flex-wrap gap-1">
                {message.attachments.map((attachment, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-background/20 px-1.5 py-0.5 text-xs">
                    <FileText className="h-3 w-3" /> {attachment.name} <span className="opacity-70">({formatSize(attachment.size)})</span>
                  </span>
                ))}
              </div>
            )}
            {message.role === "assistant" ? (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={chatMarkdownComponents}>{message.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </div>
        </div>
      ))}
      {loading && <div className="flex justify-start"><div className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">Mira is thinking…</div></div>}
    </div>
  );
}
