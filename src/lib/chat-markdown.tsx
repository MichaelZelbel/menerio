import type { ComponentProps } from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown plumbing for narrow chat surfaces.
 * - Enables GFM (tables, task lists, strikethrough, autolinks).
 * - Wraps tables in a horizontally scrollable container with compact styling
 *   so they remain readable inside a ~320px side-panel bubble.
 */
export const chatMarkdownPlugins = [remarkGfm];

export const chatMarkdownComponents: Components = {
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
