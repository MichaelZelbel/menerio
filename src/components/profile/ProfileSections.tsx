import { useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { PinnedHighlights } from "@/components/people/profile/PinnedHighlights";
import { ProfileFieldFilter } from "@/components/people/profile/ProfileFieldFilter";
import { CompactCategorySection } from "@/components/people/profile/CompactCategorySection";
import { compareCategoriesForDisplay, isCategorySectionVisible } from "@/lib/profile-taxonomy";
import { filterEntries } from "@/lib/profile-field-filter";
import type { ProfileCategory } from "@/hooks/useProfile";
import type { ContactProfileEntry } from "@/hooks/useContactProfile";

export type ProfileSectionsEntry = ContactProfileEntry | ProfileCategory;

interface ProfileSectionsProps {
  categories: ProfileCategory[];
  entries: ProfileEntry[];
  onSaveEntry: (data: any) => void;
  onDeleteEntry: (id: string) => void;
  onTogglePin: (entry: ProfileEntry) => void;
  onUpdateCategory: (data: Partial<ProfileCategory> & { id: string }) => void;
  onDeleteCategory: (id: string) => void;
  onAddCategory: (data: Partial<ProfileCategory>) => void;
  /** Render the user's own profile scope editing UI. */
  showScope?: boolean;
  /** Render the pinned-highlights strip (contact profiles only). */
  showPinned?: boolean;
  /** Optional extra content rendered between pinned highlights and the filter. */
  children?: ReactNode;
}

/**
 * The single, shared profile facts surface used by both the user's own profile
 * and contact detail pages. It owns category sorting, filtering, pinned
 * highlights, and the compact per-category sections so both pages behave and
 * render identically.
 */
export function ProfileSections({
  categories,
  entries,
  onSaveEntry,
  onDeleteEntry,
  onTogglePin,
  onUpdateCategory,
  onDeleteCategory,
  onAddCategory,
  showScope = false,
  showPinned = false,
  children,
}: ProfileSectionsProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("folder");
  const [newCatScope, setNewCatScope] = useState("all");

  const sectionCategories = useMemo(
    () =>
      categories
        .filter((c) => isCategorySectionVisible(c, entries.some((e) => e.category_id === c.id)))
        .slice()
        .sort(compareCategoriesForDisplay),
    [categories, entries],
  );

  const matches = useMemo(() => filterEntries(entries, filterQuery), [entries, filterQuery]);
  const isFiltering = filterQuery.trim().length > 0;

  const visibleCategories = isFiltering
    ? sectionCategories.filter((c) => entries.some((e) => e.category_id === c.id && matches.has(e.id)))
    : sectionCategories;

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const slug = newCatName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    onAddCategory({
      name: newCatName.trim(),
      slug,
      icon: newCatIcon,
      visibility_scope: newCatScope,
      sort_order: categories.length,
      is_default: false,
    });
    setAddingCategory(false);
    setNewCatName("");
    setNewCatIcon("folder");
    setNewCatScope("all");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Facts</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAddingCategory(true)}>
              <Plus className="h-3.5 w-3.5 mr-2" /> Add custom category
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {addingCategory && (
        <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              placeholder="Category name"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="Icon (e.g. heart)"
              value={newCatIcon}
              onChange={(e) => setNewCatIcon(e.target.value)}
              className="text-sm"
            />
            <Select value={newCatScope} onValueChange={setNewCatScope}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAddingCategory(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddCategory} disabled={!newCatName.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}

      {showPinned && <PinnedHighlights entries={entries} onTogglePin={onTogglePin} />}

      {children}

      <ProfileFieldFilter value={filterQuery} onChange={setFilterQuery} />

      {isFiltering && visibleCategories.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No facts match "{filterQuery.trim()}".</p>
      )}

      {visibleCategories.map((cat) => (
        <CompactCategorySection
          key={cat.id}
          category={cat}
          entries={entries.filter((e) => e.category_id === cat.id)}
          filterQuery={filterQuery}
          matches={matches}
          onSaveEntry={onSaveEntry}
          onDeleteEntry={onDeleteEntry}
          onTogglePin={onTogglePin}
          onUpdateCategory={onUpdateCategory}
          onDeleteCategory={onDeleteCategory}
          allowPin={showPinned}
          showScope={showScope}
        />
      ))}
    </div>
  );
}
