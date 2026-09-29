import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Send, Globe, Brain, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

interface CaptureEmptyStateProps {
  onCreateNote?: () => void;
  variant?: "compact" | "full";
  className?: string;
}

interface CaptureOption {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}

const OPTIONS: CaptureOption[] = [
  {
    key: "telegram",
    title: "Telegram",
    description: "Send messages to your bot to capture ideas on the go.",
    icon: Send,
    to: "/dashboard/settings?tab=telegram",
  },
  {
    key: "singlefile",
    title: "Web Clipper",
    description: "Save any web page as a Markdown note in one click.",
    icon: Globe,
    to: "/dashboard/settings?tab=singlefile",
  },
  {
    key: "mcp",
    title: "MCP Server",
    description: `Capture from Claude or ChatGPT with one ${BRAND.name} key.`,
    icon: Brain,
    to: "/dashboard/settings?tab=mcp",
  },
];

// The look of a Card, on the button or link itself: these tiles were clickable
// divs, so a keyboard could not reach them.
const TILE_CLASS =
  "block w-full text-left rounded-xl border bg-card text-card-foreground shadow-md cursor-pointer hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function TileBody({
  icon: Icon,
  title,
  description,
  iconWrapClassName,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  iconWrapClassName: string;
  iconClassName: string;
}) {
  return (
    <span className="flex items-start gap-3 p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", iconWrapClassName)}>
        <Icon className={cn("h-5 w-5", iconClassName)} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium mb-0.5">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </span>
  );
}

export function CaptureEmptyState({ onCreateNote, variant = "full", className }: CaptureEmptyStateProps) {
  const compact = variant === "compact";

  return (
    <div className={cn("w-full", compact ? "p-4" : "p-6", className)}>
      <div className={cn("text-center", compact ? "mb-4" : "mb-6")}>
        <h3 className={cn("font-display font-semibold", compact ? "text-base mb-1" : "text-lg mb-2")}>
          Start capturing your thoughts
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Create a note now or set up an integration to capture from anywhere.
        </p>
      </div>

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        {onCreateNote && (
          <button type="button" className={cn(TILE_CLASS, "border-dashed")} onClick={onCreateNote}>
            <TileBody
              icon={Plus}
              title="Quick Capture"
              description="Write a note right here in your browser."
              iconWrapClassName="bg-primary/10"
              iconClassName="text-primary"
            />
          </button>
        )}

        {OPTIONS.map((opt) => (
          <Link key={opt.key} to={opt.to} className={TILE_CLASS}>
            <TileBody
              icon={opt.icon}
              title={opt.title}
              description={opt.description}
              iconWrapClassName="bg-muted"
              iconClassName="text-muted-foreground"
            />
          </Link>
        ))}
      </div>

      {onCreateNote && !compact && (
        <div className="flex justify-center mt-6">
          <Button onClick={onCreateNote} className="gap-2">
            <Plus className="h-4 w-4" /> Create your first note
          </Button>
        </div>
      )}
    </div>
  );
}
