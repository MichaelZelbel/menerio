import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAICredits } from "@/hooks/useAICredits";
import { Button } from "@/components/ui/button";

export function LowBalanceBanner() {
  const { credits } = useAICredits();

  if (!credits || credits.creditsGranted <= 0) return null;
  if (credits.remainingCredits > 0) return null;

  return (
    <div
      className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
      role="status"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span>No AI credits left this period. AI features are paused until the next reset.</span>
      </div>
      <Button asChild size="sm" variant="destructive" className="h-7 text-xs">
        <Link to="/dashboard/settings?tab=credits">Manage credits</Link>
      </Button>
    </div>
  );
}
