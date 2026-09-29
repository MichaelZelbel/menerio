import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  History,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileIcon } from "@/components/profile/ProfileIcon";
import { ProfileRow } from "@/components/profile/ProfileRow";
import { ProfileValue } from "@/components/profile/ProfileValue";
import { ScopeBadge, SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { EntryForm, type EntryFormData } from "@/components/profile/EntryForm";
import { CATEGORY_SUGGESTED_LABELS } from "@/lib/profile-suggestions";
import { highlightSegments, type FieldMatch } from "@/lib/profile-field-filter";
import { formatValidityRange } from "@/lib/claims";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import type { ProfileCategory } from "@/hooks/useProfile";
import { OTHER_SECTION, type FactActions, type FactSection, type FactSlot, type ProfileFact } from "@/hooks/useFacts";

export interface SectionOption {
  slug: string | null;
  name: string;
}

interface CompactCategorySectionProps {
  section: FactSection;
  filterQuery: string;
  /** Filter matches keyed by claim id. */
  matches: Map<string, FieldMatch>;
  actions: FactActions;
  /** Where a slot can be moved to. */
  sectionOptions?: SectionOption[];
  onUpdateCategory: (section: FactSection, patch: Partial<ProfileCategory>) => void;
  onDeleteCategory: (section: FactSection) => void;
  allowPin?: boolean;
  /** Show the section's visibility scope and let it be changed. */
  showScope?: boolean;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.matched ? (
          <mark key={i} className="rounded-sm bg-warning/40 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

type Editing = { fact: ProfileFact; mode: "changed" | "fix" | "date" } | null;

/** A value that "It changed" dated in the future: not current yet, and not ended. */
const startsLater = (fact: ProfileFact) => !fact.is_current && fact.valid_to === null;

/**
 * One section of facts, used by both the user's own profile and a person's
 * page. Each attribute (slot) is one row: its current values on one line, a
 * "History (n)" disclosure, a "two answers" badge when a single-valued
 * attribute has more than one current value, and menus to change, end or
 * retract a value and to re-file the slot.
 */
export function CompactCategorySection({
  section,
  filterQuery,
  matches,
  actions,
  sectionOptions = [],
  onUpdateCategory,
  onDeleteCategory,
  allowPin = true,
  showScope = false,
}: CompactCategorySectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [addingEntry, setAddingEntry] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(section.name);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isOther = section.key === OTHER_SECTION;
  // The database refuses to delete a private section that still holds facts
  // (they would fall back to "Other" and reach assistants), so it is not offered.
  const deleteRefused = section.visibilityScope === "private" && section.slots.length > 0;
  const isFiltering = filterQuery.trim().length > 0;
  const isOpen = isFiltering || expanded;
  const slotMatches = (slot: FactSlot) =>
    [...slot.current, ...slot.history].some((f) => matches.has(f.claim_id));
  const visibleSlots = isFiltering ? section.slots.filter(slotMatches) : section.slots;
  const currentCount = section.slots.filter((s) => s.current.length > 0).length;

  const suggestedLabels = section.slug ? CATEGORY_SUGGESTED_LABELS[section.slug] ?? [] : [];
  const existingLabels = section.slots.map((s) => s.label);

  const handleAdd = (data: EntryFormData) => {
    actions.add({
      label: data.label,
      value: data.value,
      category_slug: data.category_slug,
      linked_note_id: data.linked_note_id,
    });
    setAddingEntry(false);
  };

  const handleRenameSave = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== section.name) onUpdateCategory(section, { name: trimmed });
    setRenaming(false);
  };

  return (
    <div id={`cat-${section.slug ?? "other"}`} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 group">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={isOpen ? "Collapse section" : "Expand section"}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <ProfileIcon name={section.icon ?? "circle"} className="h-4 w-4 text-muted-foreground shrink-0" />

        {renaming ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSave();
                if (e.key === "Escape") {
                  setRenameValue(section.name);
                  setRenaming(false);
                }
              }}
              className="h-7 text-sm"
            />
            <Button aria-label="Save name" variant="ghost" size="icon" className="h-6 w-6" onClick={handleRenameSave}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              aria-label="Cancel rename"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setRenameValue(section.name);
                setRenaming(false);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="font-medium text-sm flex-1 truncate">{section.name}</span>
        )}

        {showScope && !isOther && <ScopeBadge scope={section.visibilityScope} />}
        <span className="text-xs text-muted-foreground shrink-0">{currentCount}</span>

        {!isOther && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Category actions"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setAddingEntry(true);
                  setExpanded(true);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-2" /> Add entry
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(section.name);
                  setRenaming(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-2" /> Rename category
              </DropdownMenuItem>
              {showScope && (
                <>
                  <DropdownMenuSeparator />
                  {SCOPE_OPTIONS.map((o) => (
                    <DropdownMenuItem key={o.value} onSelect={() => onUpdateCategory(section, { visibility_scope: o.value })}>
                      {section.visibilityScope === o.value ? (
                        <Check className="h-3.5 w-3.5 mr-2" />
                      ) : (
                        <span className="w-3.5 mr-2" />
                      )}
                      Visible to {o.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {section.category && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete category
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {addingEntry && (
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <EntryForm
            categorySlug={section.slug}
            suggestedLabels={suggestedLabels}
            existingLabels={existingLabels}
            onSave={handleAdd}
            onCancel={() => setAddingEntry(false)}
          />
        </div>
      )}

      {isOpen && !addingEntry && visibleSlots.length === 0 && !isFiltering && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <span className="text-sm text-muted-foreground">No facts yet. Add one.</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 shrink-0"
            onClick={() => {
              setAddingEntry(true);
              setExpanded(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      )}

      {isOpen && visibleSlots.length > 0 && (
        <div className="border-t border-border">
          {visibleSlots.map((slot) => (
            <SlotRow
              key={slot.key}
              slot={slot}
              filterQuery={filterQuery}
              actions={actions}
              sectionOptions={sectionOptions}
              allowPin={allowPin}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{section.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRefused
                ? `It is private and still holds ${section.slots.length} fact${section.slots.length === 1 ? "" : "s"}. Moved to "Other" they would be shown to assistants, so move or remove them first.`
                : section.slots.length > 0
                  ? `Its ${section.slots.length} fact${section.slots.length === 1 ? "" : "s"} move to "Other". No fact is deleted.`
                  : "This category has no facts."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{deleteRefused ? "Close" : "Cancel"}</AlertDialogCancel>
            {!deleteRefused && <AlertDialogAction onClick={() => onDeleteCategory(section)}>Delete</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SlotRow({
  slot,
  filterQuery,
  actions,
  sectionOptions,
  allowPin,
}: {
  slot: FactSlot;
  filterQuery: string;
  actions: FactActions;
  sectionOptions: SectionOption[];
  allowPin: boolean;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing>(null);
  const [renaming, setRenaming] = useState(false);
  const [labelValue, setLabelValue] = useState(slot.label);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingRetract, setPendingRetract] = useState<ProfileFact | null>(null);

  const saveLabel = () => {
    const trimmed = labelValue.trim();
    if (trimmed && trimmed !== slot.label) actions.updateSlot(slot, { label: trimmed });
    setRenaming(false);
  };

  const valueActions = (fact: ProfileFact) => (
    <>
      {slot.hasConflict && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => actions.keepOnly(slot, fact)}
          aria-label={`Keep this one: ${fact.value}`}
        >
          Keep this one
        </Button>
      )}
      {fact.source_type === "note" && fact.source_id && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Open linked note"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => navigate(`/dashboard/notes/${fact.source_id}`)}
            >
              <LinkIcon className="h-3.5 w-3.5 text-primary" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open the note this came from</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Edit entry" variant="ghost" size="icon" className="h-7 w-7">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing({ fact, mode: "changed" })}>
            It changed
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing({ fact, mode: "fix" })}>
            Fix a mistake
          </DropdownMenuItem>
          {fact.valid_from && (
            <DropdownMenuItem onSelect={() => setEditing({ fact, mode: "date" })}>
              Fix the date
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Remove entry" variant="ghost" size="icon" className="h-7 w-7 text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => actions.end(fact)}>
            No longer true
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setPendingRetract(fact)}
          >
            Was wrong
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const slotActions = (
    <>
      {allowPin && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={slot.isPinned ? "Unpin" : "Pin"}
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => actions.updateSlot(slot, { is_pinned: !slot.isPinned })}
            >
              {slot.isPinned ? <PinOff className="h-3.5 w-3.5 text-primary" /> : <Pin className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{slot.isPinned ? "Unpin" : "Pin"}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Fact options" variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setLabelValue(slot.label);
              setRenaming(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename label
          </DropdownMenuItem>
          {sectionOptions.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-3.5 w-3.5 mr-2" /> Move to section
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {sectionOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.slug ?? OTHER_SECTION}
                    disabled={option.slug === slot.categorySlug}
                    onSelect={() => actions.updateSlot(slot, { category_slug: option.slug })}
                  >
                    {option.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={() => actions.updateSlot(slot, { show_to_agent: !slot.showToAgent })}>
            {slot.showToAgent ? <Check className="h-3.5 w-3.5 mr-2" /> : <Bot className="h-3.5 w-3.5 mr-2" />}
            Always show to assistants
          </DropdownMenuItem>
          {slot.hasConflict && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Two answers</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => actions.updateSlot(slot, { cardinality: "many" })}>
                Both are true
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const label = renaming ? (
    <span className="inline-flex items-center gap-1">
      <Input
        autoFocus
        aria-label="Label"
        value={labelValue}
        onChange={(e) => setLabelValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveLabel();
          if (e.key === "Escape") setRenaming(false);
        }}
        className="h-6 w-40 text-xs"
      />
      <Button aria-label="Save label" variant="ghost" size="icon" className="h-6 w-6" onClick={saveLabel}>
        <Check className="h-3 w-3" />
      </Button>
    </span>
  ) : (
    <Highlighted text={slot.label} query={filterQuery} />
  );

  const single = slot.current.length === 1;

  return (
    <div className="border-b border-border last:border-b-0">
      {editing && (
        <div className="px-4 py-3 border-b border-border">
          <EntryForm
            key={`${editing.fact.claim_id}:${editing.mode}`}
            mode={editing.mode}
            initial={{ label: slot.label, value: editing.fact.value, valid_from: editing.fact.valid_from }}
            defaultSince={actions.today?.()}
            categorySlug={slot.categorySlug}
            onSave={(data) => {
              if (editing.mode === "changed") actions.changed(editing.fact, data.value, data.valid_from!);
              else if (editing.mode === "date") actions.redate(editing.fact, data.valid_from!);
              else actions.fix(editing.fact, data.value);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      <ProfileRow
        className="!border-b-0"
        label={label}
        actions={
          <>
            {single && valueActions(slot.current[0])}
            {slotActions}
          </>
        }
      >
        {slot.hasConflict && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="h-3 w-3" /> Two answers
          </Badge>
        )}
        {slot.current.length === 0 ? (
          <span className="text-sm text-muted-foreground">Nothing current</span>
        ) : (
          <ProfileValue
            label={slot.label}
            values={slot.current.map((f) => f.value)}
            renderText={(t) => <Highlighted text={t} query={filterQuery} />}
            itemActions={
              single
                ? undefined
                : (i) => (
                    <span className="ml-auto flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                      {valueActions(slot.current[i])}
                    </span>
                  )
            }
          />
        )}
        {slot.hasConflict && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => actions.updateSlot(slot, { cardinality: "many" })}
          >
            Both are true
          </Button>
        )}
      </ProfileRow>
      {slot.history.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="px-4 pb-1.5">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground">
              <History className="h-3 w-3" />
              History ({slot.history.length})
              <ChevronDown className={cn("h-3 w-3 transition-transform", historyOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 space-y-0.5 pl-6 text-xs text-muted-foreground">
              {slot.history.map((fact) => {
                const later = startsLater(fact);
                const range = formatValidityRange(fact, actions.today?.());
                return (
                  <li key={fact.claim_id} className="group/hist flex items-center gap-1">
                    <span className="min-w-0">
                      <span className="text-foreground/80">{fact.value}</span>
                      {range ? `, ${range}` : ""}
                    </span>
                    {/* A history row can hold a mistake too: a mistyped future
                        date, a typo, or "No longer true" pressed by accident. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={`History entry options: ${fact.value}`}
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover/hist:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {later ? (
                          <DropdownMenuItem onSelect={() => setEditing({ fact, mode: "date" })}>
                            Fix the date
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => actions.reopen(fact)}>Still true</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setEditing({ fact, mode: "fix" })}>
                          Fix a mistake
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setPendingRetract(fact)}
                        >
                          Was wrong
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      <AlertDialog open={!!pendingRetract} onOpenChange={(open) => !open && setPendingRetract(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              "{slot.label}: {pendingRetract?.value}" was wrong?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It is deleted with no history kept, and {BRAND.name} will not suggest it again.
              {pendingRetract?.is_current
                ? ' If it was true once and has changed, use "No longer true" instead.'
                : pendingRetract && startsLater(pendingRetract)
                  ? " The value it was to replace stays current."
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRetract) actions.retract(pendingRetract);
                setPendingRetract(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
