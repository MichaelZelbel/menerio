import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { useAICredits } from "@/hooks/useAICredits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LowBalanceBanner() {
  const { credits } = useAICredits();
  const [dismissedPeriod, setDismissedPeriod] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissedPeriod(localStorage.getItem("lowBalanceDismissedPeriod"));
    } catch { /* ignore */ }
  }, []);

  const state = useMemo(() => {
    if (!credits || credits.creditsGranted <= 0) return null;
    const ratio = credits.remainingCredits / credits.creditsGranted;
    if (credits.remainingCredits <= 0) return "empty" as const;
    if (ratio < 0.1) return "low" as const;
    return null;
  }, [credits]);

  if (!state || !credits) return null;
  if (dismissedPeriod === credits.periodStart && state === "low") return null;

  const isEmpty = state === "empty";
  const handleDismiss = () => {
    try { localStorage.setItem("lowBalanceDismissedPeriod", credits.periodStart); } catch { /* ignore */ }
    setDismissedPeriod(credits.periodStart);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-sm",
        isEmpty
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
      role="status"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        {isEmpty ? (
          <span>No AI credits left this period. AI features are paused until the next reset.</span>
        ) : (
          <span>
            AI credits running low — {credits.remainingCredits} of {credits.creditsGranted} remaining (&lt;10%).
          </span>
        )}
      </div>
      <Button asChild size="sm" variant={isEmpty ? "destructive" : "outline"} className="h-7 text-xs">
        <Link to="/dashboard/settings?tab=credits">Manage credits</Link>
      </Button>
      {!isEmpty && (
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleDismiss} aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
