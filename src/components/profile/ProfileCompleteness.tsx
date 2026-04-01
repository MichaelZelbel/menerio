import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileIcon } from "./ProfileIcon";
import type { ProfileCategory, ProfileEntry } from "@/hooks/useProfile";

interface ProfileCompletenessProps {
  categories: ProfileCategory[];
  entries: ProfileEntry[];
}

function getCompletenessMessage(pct: number): string {
  if (pct <= 20) return "Just getting started — every entry helps AI understand you better";
  if (pct <= 50) return "Nice progress! Your agents are getting to know you";
  if (pct <= 80) return "Looking great — your AI context is getting rich";
  return "Impressive! Your agents have excellent context about who you are";
}

export function ProfileCompleteness({ categories, entries }: ProfileCompletenessProps) {
  const navigate = useNavigate();

  const { pct, emptyCategories } = useMemo(() => {
    if (categories.length === 0) return { pct: 0, emptyCategories: [] };
    const filled = categories.filter((c) => entries.some((e) => e.category_id === c.id));
    const pct = Math.round((filled.length / categories.length) * 100);
    const emptyCategories = categories.filter((c) => !entries.some((e) => e.category_id === c.id));
    return { pct, emptyCategories };
  }, [categories, entries]);

  const radius = 36;
  const stroke = 5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-4">
      {/* Progress ring */}
      <div className="relative shrink-0">
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle
            cx="42" cy="42" r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
          />
          <circle
            cx="42" cy="42" r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 42 42)"
            className="transition-all duration-700"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
          {pct}%
        </span>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm font-medium">{getCompletenessMessage(pct)}</p>
        {emptyCategories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {emptyCategories.slice(0, 6).map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  const el = document.getElementById(`cat-${cat.slug}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-full border border-border hover:border-primary/40"
              >
                <ProfileIcon name={cat.icon || "folder"} className="h-3 w-3" />
                {cat.name}
              </button>
            ))}
            {emptyCategories.length > 6 && (
              <span className="text-xs text-muted-foreground px-2 py-0.5">
                +{emptyCategories.length - 6} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact version for dashboard widget */
export function ProfileCompletenessRing({
  categories,
  entries,
  size = 48,
}: ProfileCompletenessProps & { size?: number }) {
  const pct = useMemo(() => {
    if (categories.length === 0) return 0;
    const filled = categories.filter((c) => entries.some((e) => e.category_id === c.id));
    return Math.round((filled.length / categories.length) * 100);
  }, [categories, entries]);

  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="hsl(var(--muted))" strokeWidth={3}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="hsl(var(--primary))" strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
        {pct}%
      </span>
    </div>
  );
}

/** Returns completeness percentage */
export function useProfileCompleteness(categories: ProfileCategory[], entries: ProfileEntry[]) {
  return useMemo(() => {
    if (categories.length === 0) return 0;
    const filled = categories.filter((c) => entries.some((e) => e.category_id === c.id));
    return Math.round((filled.length / categories.length) * 100);
  }, [categories, entries]);
}
