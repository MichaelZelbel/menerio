import { cn } from "@/lib/utils";
import {
  FileText,
  Star,
  Trash2,
  Brain,
  Search,
} from "lucide-react";

export type NoteFilter = "all" | "favorites" | "trash";

interface NoteSidebarProps {
  filter: NoteFilter;
  onFilterChange: (f: NoteFilter) => void;
  counts: { all: number; favorites: number; trash: number };
  onSearchToggle: () => void;
  searchActive: boolean;
}

const filters: { key: NoteFilter; label: string; icon: typeof FileText }[] = [
  { key: "all", label: "All Notes", icon: FileText },
  { key: "favorites", label: "Favorites", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 },
];

export function NoteSidebar({
  filter,
  onFilterChange,
  counts,
  onSearchToggle,
  searchActive,
}: NoteSidebarProps) {
  return (
    <div className="flex flex-col h-full bg-sidebar-background text-sidebar-foreground">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Brain className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold font-display">OpenBrain</span>
        </div>
      </div>

      {/* Search */}
      <button
        onClick={onSearchToggle}
        className={cn(
          "flex items-center gap-2 mx-3 mt-3 px-3 py-2 rounded-md text-sm transition-colors",
          searchActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
        )}
      >
        <Search className="h-4 w-4" />
        <span>Search</span>
      </button>

      {/* Filters */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
              filter === f.key
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
            )}
          >
            <f.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{f.label}</span>
            <span className="text-[10px] text-muted-foreground">
              {counts[f.key]}
            </span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground">
          © {new Date().getFullYear()} OpenBrain
        </p>
      </div>
    </div>
  );
}
