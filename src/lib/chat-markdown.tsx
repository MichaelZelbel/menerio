import type { ComponentProps } from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown plumbing for chat surfaces (global FAB + people conversation).
 * - Enables GFM (tables, task lists, strikethrough, autolinks).
 * - Normalizes heading / paragraph / list / code spacing so LLM markdown
 *   remains readable inside a chat bubble regardless of what heading levels
 *   the model chose.
 */
export const chatMarkdownPlugins = [remarkGfm];

export const chatMarkdownComponents: Components = {
  // Headings: cap visual weight so an H1 doesn't dwarf the bubble.
  h1: ({ node: _node, ...props }: ComponentProps<"h1"> & { node?: unknown }) => (
    <h1 {...props} className="text-base font-semibold mt-3 mb-1.5 first:mt-0 leading-snug" />
  ),
  h2: ({ node: _node, ...props }: ComponentProps<"h2"> & { node?: unknown }) => (
    <h2 {...props} className="text-sm font-semibold mt-3 mb-1 first:mt-0 leading-snug" />
  ),
  h3: ({ node: _node, ...props }: ComponentProps<"h3"> & { node?: unknown }) => (
    <h3 {...props} className="text-sm font-medium mt-2 mb-1 first:mt-0 leading-snug" />
  ),
  h4: ({ node: _node, ...props }: ComponentProps<"h4"> & { node?: unknown }) => (
    <h4 {...props} className="text-sm font-medium mt-2 mb-1 first:mt-0 leading-snug" />
  ),
  p: ({ node: _node, ...props }: ComponentProps<"p"> & { node?: unknown }) => (
    <p {...props} className="my-1.5 leading-relaxed first:mt-0 last:mb-0" />
  ),
  ul: ({ node: _node, ...props }: ComponentProps<"ul"> & { node?: unknown }) => (
    <ul {...props} className="my-1.5 pl-5 space-y-1 list-disc first:mt-0 last:mb-0" />
  ),
  ol: ({ node: _node, ...props }: ComponentProps<"ol"> & { node?: unknown }) => (
    <ol {...props} className="my-1.5 pl-5 space-y-1 list-decimal first:mt-0 last:mb-0" />
  ),
  li: ({ node: _node, ...props }: ComponentProps<"li"> & { node?: unknown }) => (
    <li {...props} className="leading-relaxed" />
  ),
  code: ({ node: _node, className, ...props }: ComponentProps<"code"> & { node?: unknown }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) return <code {...props} className={className} />;
    return (
      <code
        {...props}
        className="px-1 py-0.5 rounded bg-background/40 text-[0.85em] font-mono"
      />
    );
  },
  pre: ({ node: _node, ...props }: ComponentProps<"pre"> & { node?: unknown }) => (
    <pre {...props} className="my-2 p-2 rounded bg-background/40 overflow-x-auto text-xs" />
  ),
  a: ({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
    <a {...props} className="underline underline-offset-2 hover:opacity-80" target="_blank" rel="noreferrer" />
  ),
  table: ({ node: _node, ...props }: ComponentProps<"table"> & { node?: unknown }) => (
    <div className="my-2 -mx-1 overflow-x-auto">
      <table {...props} className="w-full border-collapse text-xs" />
    </div>
  ),
  thead: ({ node: _node, ...props }: ComponentProps<"thead"> & { node?: unknown }) => (
    <thead {...props} className="bg-muted/50" />
  ),
  th: ({ node: _node, ...props }: ComponentProps<"th"> & { node?: unknown }) => (
    <th {...props} className="border border-border px-2 py-1 text-left align-top font-medium" />
  ),
  td: ({ node: _node, ...props }: ComponentProps<"td"> & { node?: unknown }) => (
    <td {...props} className="border border-border px-2 py-1 align-top" />
  ),
};
