import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const scopeConfig: Record<string, { label: string; className: string }> = {
  all: { label: "All", className: "bg-info/15 text-info border-info/30" },
  professional: { label: "Professional", className: "bg-success/15 text-success border-success/30" },
  personal: { label: "Personal", className: "bg-warning/15 text-warning border-warning/30" },
  health: { label: "Health", className: "bg-error/15 text-error border-error/30" },
  private: { label: "Private", className: "bg-muted text-muted-foreground border-border" },
};

export function ScopeBadge({ scope, className }: { scope: string; className?: string }) {
  const config = scopeConfig[scope] ?? scopeConfig.all;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-normal", config.className, className)}>
      {config.label}
    </Badge>
  );
}

export const SCOPE_OPTIONS = [
  { value: "all", label: "All agents" },
  { value: "professional", label: "Professional only" },
  { value: "personal", label: "Personal only" },
  { value: "health", label: "Health only" },
  { value: "private", label: "Private (never shared)" },
];
