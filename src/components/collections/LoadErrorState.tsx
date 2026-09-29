import { Link } from "react-router-dom";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a list or page shows when its data failed to load. A failed load used
 * to fall through to the empty state ("No collections yet", "No groups yet"),
 * which told people their data was gone and invited them to create it again.
 */
export function LoadErrorState({
  title,
  description = "Check your connection and try again.",
  onRetry,
  backTo,
  backLabel,
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  backTo?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-dashed px-4 py-12 text-center",
        className,
      )}
    >
      <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        )}
        {backTo && (
          <Button asChild variant="ghost" size="sm">
            <Link to={backTo}>{backLabel ?? "Back"}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
