import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

interface Person {
  id: string;
  name: string;
  aliases: string[];
}

interface DuplicateHintsProps {
  person: Person;
  allPeople: Person[];
  onMergeSuggested?: () => void;
}

/**
 * Lightweight duplicate detection based on name similarity.
 * Shows a hint if there are possible duplicates.
 */
export function DuplicateHints({ person, allPeople, onMergeSuggested }: DuplicateHintsProps) {
  const duplicates = findPossibleDuplicates(person, allPeople);

  if (duplicates.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Users className="h-4 w-4" />
        Possible duplicate{duplicates.length > 1 ? "s" : ""} detected
      </div>
      <div className="flex flex-wrap gap-1.5">
        {duplicates.map((d) => (
          <Badge key={d.id} variant="outline" className="text-xs border-amber-500/30">
            {d.name}
            <span className="ml-1 text-muted-foreground">({d.reason})</span>
          </Badge>
        ))}
      </div>
      {onMergeSuggested && (
        <button
          onClick={onMergeSuggested}
          className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
        >
          Review and merge →
        </button>
      )}
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
    for (const pn of personNames) {
      for (const on of otherNames) {
        if (pn === on) {
          matches.push({ id: other.id, name: other.name, reason: "same name" });
          break;
        }
      }
      if (matches.some((m) => m.id === other.id)) break;
    }
    if (matches.some((m) => m.id === other.id)) continue;

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
          break;
        }
      }
      if (matches.some((m) => m.id === other.id)) break;
    }
  }

  return matches.slice(0, 5); // Limit to 5 suggestions
}

export { findPossibleDuplicates };
