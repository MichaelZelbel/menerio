import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileIcon } from "./ProfileIcon";
import type { ProfileCategory } from "@/hooks/useProfile";
import type { ProfileFact } from "@/hooks/useFacts";

/** The section slugs that hold at least one current fact. */
export function filledSlugs(facts: Pick<ProfileFact, "category_slug" | "is_current">[]): Set<string> {
  return new Set(facts.filter((f) => f.is_current && f.category_slug).map((f) => f.category_slug!));
}

interface ProfileCompletenessProps {
  categories: ProfileCategory[];
  /** The subject's profile_facts rows (history is ignored). */
  facts: Pick<ProfileFact, "category_slug" | "is_current">[];
  /**
   * Override the completeness denominator instead of using the number of
   * materialized category rows. The contact profile no longer auto-seeds
   * all 17 taxonomy categories on first visit (Phase 3), so a contact with
   * one materialized category would otherwise show 100% complete — pass the
   * static taxonomy slot count (e.g. `PROFILE_TAXONOMY.length`) there. The
   * owner page omits this prop and keeps its original per-row denominator.
   */
  totalSlots?: number;
}

function getCompletenessMessage(pct: number): string {
  if (pct <= 20) return "Just getting started. Every entry helps AI understand you better";
  if (pct <= 50) return "Nice progress! Your agents are getting to know you";
  if (pct <= 80) return "Looking great. Your AI context is getting rich";
  return "Impressive! Your agents have excellent context about who you are";
}

export function ProfileCompleteness({ categories, facts, totalSlots }: ProfileCompletenessProps) {
  const navigate = useNavigate();

  const { pct, emptyCategories } = useMemo(() => {
    const denominator = totalSlots ?? categories.length;
    if (denominator === 0) return { pct: 0, emptyCategories: [] };
    const filledSet = filledSlugs(facts);
    // With a fixed slot count (a person's page, whose sections are not seeded)
    // every filled section counts; otherwise only the seeded rows do.
    const filledCount =
      totalSlots !== undefined
        ? Math.min(filledSet.size, totalSlots)
        : categories.filter((c) => filledSet.has(c.slug)).length;
    const pct = Math.round((filledCount / denominator) * 100);
    const emptyCategories = categories.filter((c) => !filledSet.has(c.slug));
    return { pct, emptyCategories };
  }, [categories, facts, totalSlots]);

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
  facts,
  size = 48,
}: ProfileCompletenessProps & { size?: number }) {
  const pct = useProfileCompleteness(categories, facts);

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
export function useProfileCompleteness(
  categories: ProfileCategory[],
  facts: Pick<ProfileFact, "category_slug" | "is_current">[],
) {
  return useMemo(() => {
    if (categories.length === 0) return 0;
    const filledSet = filledSlugs(facts);
    const filled = categories.filter((c) => filledSet.has(c.slug));
    return Math.round((filled.length / categories.length) * 100);
  }, [categories, facts]);
}
