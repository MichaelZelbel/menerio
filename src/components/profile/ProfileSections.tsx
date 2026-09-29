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
import { CompactCategorySection, type SectionOption } from "@/components/people/profile/CompactCategorySection";
import { PROFILE_TAXONOMY, taxonomyBySlug, taxonomyOrder } from "@/lib/profile-taxonomy";
import { filterEntries } from "@/lib/profile-field-filter";
import { showToast } from "@/lib/toast";
import type { ProfileCategory } from "@/hooks/useProfile";
import { groupFacts, groupSlots, type FactActions, type FactSection, type ProfileFact } from "@/hooks/useFacts";

interface ProfileSectionsProps {
  categories: ProfileCategory[];
  /** Every profile_facts row of the subject: current values and history. */
  facts: ProfileFact[];
  actions: FactActions;
  onUpdateCategory: (data: Partial<ProfileCategory> & { id: string }) => void;
  onDeleteCategory: (id: string) => void;
  onAddCategory: (data: Partial<ProfileCategory>) => void;
  /** Show each section's visibility scope and let it be changed. */
  showScope?: boolean;
  /** Render the pinned-highlights strip. */
  showPinned?: boolean;
  /** Optional extra content rendered between pinned highlights and the filter. */
  children?: ReactNode;
  /** Sections this page renders elsewhere, so a line is never moved into them. */
  excludeSlugs?: string[];
}

/**
 * Every section a line can be moved to: the taxonomy, the subject's own custom
 * sections, and "Other", minus the ones this page does not list. A person's
 * page shows "Relationships & Family" inside the relationships card, current
 * values only and read-only, so a fact moved there could no longer be edited,
 * ended or removed (eleventh review).
 */
const NO_EXCLUDED_SECTIONS: string[] = [];

export function moveTargets(categories: Pick<ProfileCategory, "slug" | "name">[], excludeSlugs: string[] = []): SectionOption[] {
  const options = new Map<string, SectionOption>();
  for (const t of PROFILE_TAXONOMY) options.set(t.slug, { slug: t.slug, name: t.name });
  for (const c of categories) options.set(c.slug, { slug: c.slug, name: c.name });
  for (const s of excludeSlugs) options.delete(s);
  const sorted = [...options.values()].sort(
    (a, b) => taxonomyOrder(a.slug!) - taxonomyOrder(b.slug!) || a.name.localeCompare(b.name),
  );
  return [...sorted, { slug: null, name: "Other" }];
}

/**
 * The slug for a new custom section. Only a-z and 0-9 survive, so a name like
 * "健康" or "Здоровье" became "-", and the next such name collided with it on
 * the (user, person, slug) unique index, a raw database error. Accents are
 * folded ("Über mich" -> "uber-mich"), an empty result falls back to
 * "section", and a slug the subject already uses gets a number.
 */
export function customSectionSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

/**
 * The single, shared profile facts surface used by both the user's own profile
 * and a person's page. It owns section order, filtering, pinned highlights and
 * the per-section lists, so both pages behave and render identically.
 */
export function ProfileSections({
  categories,
  facts,
  actions,
  onUpdateCategory,
  onDeleteCategory,
  onAddCategory,
  showScope = false,
  showPinned = true,
  children,
  excludeSlugs = NO_EXCLUDED_SECTIONS,
}: ProfileSectionsProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("folder");
  const [newCatScope, setNewCatScope] = useState("all");

  const sections = useMemo(() => groupFacts(facts, categories), [facts, categories]);
  const slots = useMemo(() => groupSlots(facts), [facts]);

  const matches = useMemo(
    () => filterEntries(facts.map((f) => ({ id: f.claim_id, label: f.label, value: f.value })), filterQuery),
    [facts, filterQuery],
  );
  const isFiltering = filterQuery.trim().length > 0;

  const visibleSections = isFiltering
    ? sections.filter((s) =>
        s.slots.some((slot) => [...slot.current, ...slot.history].some((f) => matches.has(f.claim_id))),
      )
    : sections;

  const sectionOptions = useMemo(() => moveTargets(categories, excludeSlugs), [categories, excludeSlugs]);

  // A section shown from the taxonomy may have no row yet; changing it creates one.
  const updateSection = (section: FactSection, patch: Partial<ProfileCategory>) => {
    if (section.category) {
      onUpdateCategory({ id: section.category.id, ...patch });
      return;
    }
    if (!section.slug) return;
    const order = taxonomyOrder(section.slug);
    onAddCategory({
      name: section.name,
      slug: section.slug,
      icon: taxonomyBySlug[section.slug]?.icon ?? section.icon,
      visibility_scope: section.visibilityScope,
      sort_order: order === Number.MAX_SAFE_INTEGER ? 99 : order,
      is_default: false,
      ...patch,
    });
  };

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const sameName = categories.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (sameName) {
      showToast.error(`There is already a section called "${sameName.name}".`);
      return;
    }
    const slug = customSectionSlug(name, [...categories.map((c) => c.slug), ...excludeSlugs]);
    onAddCategory({
      name,
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
            <Button aria-label="Section actions" variant="ghost" size="icon" className="h-7 w-7">
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

      {showPinned && (
        <PinnedHighlights
          slots={slots}
          onTogglePin={(slot) => actions.updateSlot(slot, { is_pinned: !slot.isPinned })}
        />
      )}

      {children}

      <ProfileFieldFilter value={filterQuery} onChange={setFilterQuery} />

      {isFiltering && visibleSections.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No facts match "{filterQuery.trim()}".</p>
      )}

      {visibleSections.map((section) => (
        <CompactCategorySection
          key={section.key}
          section={section}
          filterQuery={filterQuery}
          matches={matches}
          actions={actions}
          sectionOptions={sectionOptions}
          onUpdateCategory={updateSection}
          onDeleteCategory={(sec) => {
            if (sec.category) onDeleteCategory(sec.category.id);
          }}
          showScope={showScope}
        />
      ))}
    </div>
  );
}
