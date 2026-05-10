import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, Globe, Brain, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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
    description: "Capture from Claude or ChatGPT through MCP tokens.",
    icon: Brain,
    to: "/dashboard/settings?tab=mcp",
  },
];

export function CaptureEmptyState({ onCreateNote, variant = "full", className }: CaptureEmptyStateProps) {
  const navigate = useNavigate();
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
          <Card
            className="border-dashed cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={onCreateNote}
          >
            <CardContent className="flex items-start gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium mb-0.5">Quick Capture</div>
                <p className="text-xs text-muted-foreground">
                  Write a note right here in your browser.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <Card
              key={opt.key}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => navigate(opt.to)}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium mb-0.5">{opt.title}</div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
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
