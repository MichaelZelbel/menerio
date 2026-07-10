import { WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

// Gate for screens that only make sense with a connection (admin,
// moderation, AI panels). Everything else should render cached data instead.
export function RequiresOnline({ children }: { children: React.ReactNode }) {
  const online = useOnline();
  if (online) return <>{children}</>;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <WifiOff className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">This page needs a connection</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        You're offline right now. Your notes are still available — this page
        will work again as soon as you're back online.
      </p>
    </div>
  );
}
