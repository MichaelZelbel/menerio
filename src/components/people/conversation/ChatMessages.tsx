import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { FilePlus2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";
import { BRAND } from "@/lib/brand";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; size: number }[];
  /** Notes this turn created, rendered as links to the new note. */
  notesCreated?: { id: string; title: string; folder_path: string }[];
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
            {message.notesCreated && message.notesCreated.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {message.notesCreated.map((note) => (
                  <Link
                    key={note.id}
                    to={`/dashboard/notes/${note.id}`}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {note.title || "Untitled"}
                      {note.folder_path ? ` · ${note.folder_path}` : ""}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {loading && <div className="flex justify-start"><div className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">{BRAND.personaName} is thinking…</div></div>}
    </div>
  );
}
