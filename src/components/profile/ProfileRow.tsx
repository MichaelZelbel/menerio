import type { ReactNode } from "react";

/**
 * The single row primitive for every profile surface (contact facts, the
 * user's own profile, relationships). One rule: a small muted `Label:` and a
 * larger, brighter value on the same baseline. Every profile section renders
 * through this so the three call sites cannot drift apart again.
 */
export function ProfileRow({
  label,
  children,
  actions,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 border-b border-border last:border-b-0 group/entry hover:bg-accent/20 transition-colors ${className}`}
    >
      <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs text-muted-foreground shrink-0">{label}:</span>
        {children}
      </div>
      {actions && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/entry:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
}
