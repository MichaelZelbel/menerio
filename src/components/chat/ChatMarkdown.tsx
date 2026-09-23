import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, chatMarkdownPlugins } from "@/lib/chat-markdown";

/**
 * Chat-bubble Markdown, as its own module so the global chat button can load
 * it lazily. GlobalAIChatFAB sits in DashboardLayout, and importing
 * react-markdown and remark-gfm there put the whole Markdown stack into the
 * main chunk that every page downloads before the chat is ever opened.
 */
export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={chatMarkdownPlugins} components={chatMarkdownComponents}>
      {children}
    </ReactMarkdown>
  );
}
