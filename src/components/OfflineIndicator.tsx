import { WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

export function OfflineIndicator() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs text-secondary-foreground shadow-lg">
        <WifiOff className="h-3.5 w-3.5" />
        <span>Offline — showing saved data</span>
      </div>
    </div>
  );
}
