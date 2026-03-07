import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PremiumBadgeProps {
  className?: string;
  /** Show label text alongside icon */
  label?: boolean;
}

export function PremiumBadge({ className, label = false }: PremiumBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-medium leading-none",
        className
      )}
    >
      <Crown className="h-2.5 w-2.5" />
      {label && <span>Premium</span>}
    </span>
  );
}
