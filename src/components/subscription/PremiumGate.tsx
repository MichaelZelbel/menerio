import { useSubscription } from "@/hooks/useSubscription";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface PremiumGateProps {
  children: React.ReactNode;
  /** Optional feature name shown in the notice */
  feature?: string;
}

export function PremiumGate({ children, feature }: PremiumGateProps) {
  const { isPremium, isLoading } = useSubscription();

  if (isLoading) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }

  if (isPremium) {
    return <>{children}</>;
  }

  return (
    <Card className="border-dashed border-muted-foreground/20">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold font-display mb-1">
          Premium Feature
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {feature
            ? `"${feature}" requires a premium role.`
            : "This feature requires a premium role."}{" "}
          Contact an administrator to request access.
        </p>
      </CardContent>
    </Card>
  );
}
