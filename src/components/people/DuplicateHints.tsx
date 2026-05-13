import { useEffect, useState } from "react";
import { Users, Merge, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Person {
  id: string;
  name: string;
  aliases: string[];
}

interface DuplicateHintsProps {
  person: Person;
  allPeople: Person[];
  onMerge?: (targetId: string) => void;
}

const DISMISS_STORAGE_KEY = "menerio.duplicateHints.dismissed";

function loadDismissed(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, string[]>) {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / SSR
  }
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

/**
 * Inline per-duplicate banners on a person's profile.
 * Each suggestion has Merge / Dismiss actions; dismissals persist locally.
 */
export function DuplicateHints({ person, allPeople, onMerge }: DuplicateHintsProps) {
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const map = loadDismissed();
    setDismissedPairs(new Set(map[person.id] ?? []));
  }, [person.id]);

  const allDuplicates = findPossibleDuplicates(person, allPeople);
  const duplicates = allDuplicates.filter((d) => !dismissedPairs.has(pairKey(person.id, d.id)));

  if (duplicates.length === 0) return null;

  const dismiss = (otherId: string) => {
    const key = pairKey(person.id, otherId);
    const map = loadDismissed();
    const next = new Set(dismissedPairs);
    next.add(key);
    setDismissedPairs(next);
    // Store under both person ids so the dismissal sticks from either profile.
    map[person.id] = Array.from(new Set([...(map[person.id] ?? []), key]));
    map[otherId] = Array.from(new Set([...(map[otherId] ?? []), key]));
    saveDismissed(map);
  };

  return (
    <div className="space-y-2">
      {duplicates.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        >
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Users className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="truncate">
              <span className="text-muted-foreground">Possible duplicate:</span>{" "}
              <span className="font-medium">{d.name}</span>{" "}
              <span className="text-xs text-muted-foreground">({d.reason})</span>
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onMerge && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => onMerge(d.id)}
              >
                <Merge className="mr-1 h-3 w-3" /> Merge
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => dismiss(d.id)}
              aria-label="Dismiss duplicate suggestion"
            >
              <X className="mr-1 h-3 w-3" /> Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface DuplicateMatch {
  id: string;
  name: string;
  reason: string;
}

function findPossibleDuplicates(person: Person, allPeople: Person[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const personNames = [person.name, ...(person.aliases || [])].map((n) => n.toLowerCase());

  for (const other of allPeople) {
    if (other.id === person.id) continue;

    const otherNames = [other.name, ...(other.aliases || [])].map((n) => n.toLowerCase());

    // Exact match
    let matched = false;
    for (const pn of personNames) {
      for (const on of otherNames) {
        if (pn === on) {
          matches.push({ id: other.id, name: other.name, reason: "same name" });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) continue;

    // One name contains the other (e.g. "Michael" vs "Michael Zelbel")
    for (const pn of personNames) {
      for (const on of otherNames) {
        if (
          pn.length >= 3 &&
          on.length >= 3 &&
          (on.startsWith(pn + " ") || pn.startsWith(on + " ") ||
           on.endsWith(" " + pn) || pn.endsWith(" " + on))
        ) {
          matches.push({ id: other.id, name: other.name, reason: "similar name" });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  return matches.slice(0, 5);
}

export { findPossibleDuplicates };
