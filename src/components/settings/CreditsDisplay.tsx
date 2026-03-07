import { useAICredits, type AICredits } from "@/hooks/useAICredits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, CalendarClock, ArrowRightLeft } from "lucide-react";

interface CreditsDisplayProps {
  /** Compact mode for sidebar usage */
  compact?: boolean;
}

export function CreditsDisplay({ compact = false }: CreditsDisplayProps) {
  const { credits, isLoading, error } = useAICredits();

  if (isLoading) {
    return compact ? (
      <div className="px-2 py-2 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2 w-full" />
      </div>
    ) : (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-48 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (error || !credits) {
    return compact ? null : (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Unable to load credit information.</p>
        </CardContent>
      </Card>
    );
  }

  const usagePercent = credits.creditsGranted > 0
    ? Math.round((credits.creditsUsed / credits.creditsGranted) * 100)
    : 0;

  const remainingPercent = 100 - usagePercent;
  const rolloverPercent = credits.creditsGranted > 0
    ? Math.round((credits.rolloverTokens / credits.tokensPerCredit / credits.creditsGranted) * 100)
    : 0;

  const resetDate = new Date(credits.periodEnd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const daysUntilReset = Math.max(
    0,
    Math.ceil((new Date(credits.periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  // --- Compact (sidebar) ---
  if (compact) {
    return (
      <div className="px-2 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI Credits
          </span>
          <span className="text-[11px] font-semibold text-foreground">
            {credits.remainingCredits}
          </span>
        </div>
        <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
          {rolloverPercent > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-info/40"
              style={{ width: `${rolloverPercent}%` }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">Resets {resetDate}</p>
      </div>
    );
  }

  // --- Full card ---
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI Credits
        </CardTitle>
        <CardDescription>Your AI usage for the current billing period.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Main stat */}
        <div className="flex items-end gap-2">
          <span className="text-4xl font-bold font-display">{credits.remainingCredits}</span>
          <span className="text-muted-foreground text-sm mb-1">/ {credits.creditsGranted} credits remaining</span>
        </div>

        {/* Progress bar with rollover indicator */}
        <div className="space-y-1.5">
          <div className="relative h-3 rounded-full bg-muted overflow-hidden">
            {rolloverPercent > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-info/30"
                style={{ width: `${rolloverPercent}%` }}
                title={`Rollover: ${Math.round(credits.rolloverTokens / credits.tokensPerCredit)} credits`}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{credits.creditsUsed} used</span>
            <span>{remainingPercent}% remaining</span>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Resets in</p>
              <p className="text-sm font-semibold">{daysUntilReset} days</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Rollover</p>
              <p className="text-sm font-semibold">
                {Math.round(credits.rolloverTokens / credits.tokensPerCredit)} credits
              </p>
            </div>
          </div>
        </div>

        {/* Rollover preview near period end */}
        {daysUntilReset <= 5 && credits.remainingCredits > 0 && (
          <div className="rounded-lg border border-info/30 bg-info/5 p-3">
            <p className="text-xs text-info font-medium mb-0.5">Rollover Preview</p>
            <p className="text-xs text-muted-foreground">
              Up to <span className="font-semibold text-foreground">
                {Math.min(credits.remainingCredits, Math.round(credits.baseTokens / credits.tokensPerCredit))}
              </span> unused credits will roll over to next period (capped at your base allocation).
            </p>
          </div>
        )}

        {/* Badge row */}
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px]">
            {credits.tokensPerCredit} tokens/credit
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            Period: {new Date(credits.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {resetDate}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
