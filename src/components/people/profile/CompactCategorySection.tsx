import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Check,
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
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileIcon } from "@/components/profile/ProfileIcon";
import { ProfileRow } from "@/components/profile/ProfileRow";
import { ProfileValue } from "@/components/profile/ProfileValue";
import { ScopeBadge, SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";

import { EntryForm } from "@/components/profile/EntryForm";
import { CATEGORY_SUGGESTED_LABELS } from "@/lib/profile-suggestions";
import { highlightSegments, type FieldMatch } from "@/lib/profile-field-filter";
import { displayLabel, splitProfileValues } from "@/lib/profile-list-labels";

import type { ProfileCategory } from "@/hooks/useProfile";
import type { ContactProfileEntry } from "@/hooks/useContactProfile";

interface CompactCategorySectionProps {
  category: ProfileCategory;
  /** All entries in this category (unfiltered) — CompactCategorySection derives the visible subset itself when filtering is active. */
  entries: ContactProfileEntry[];
  filterQuery: string;
  matches: Map<string, FieldMatch>;
  onSaveEntry: (data: any) => void;
  onDeleteEntry: (id: string) => void;
  onTogglePin: (entry: ContactProfileEntry) => void;
  onUpdateCategory: (data: Partial<ProfileCategory> & { id: string }) => void;
  onDeleteCategory: (id: string) => void;
  /** Pinned highlights only exist on contact profiles. */
  allowPin?: boolean;
  /** The user's own profile exposes icon + visibility scope editing. */
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

/**
 * The single profile section renderer, used by both contact profiles and the
 * user's own profile: default-expanded, one compact `Label: value` row per
 * entry. An empty section shows a "no facts yet" hint with its own Add
 * affordance so a newly created custom category is never a dead end.
 */
export function CompactCategorySection({
  category,
  entries,
  filterQuery,
  matches,
  onSaveEntry,
  onDeleteEntry,
  onTogglePin,
  onUpdateCategory,
  onDeleteCategory,
  allowPin = true,
  showScope = false,
}: CompactCategorySectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(category.name);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const navigate = useNavigate();

  const isFiltering = filterQuery.trim().length > 0;
  // Force-expanded while a filter is active, without touching (and losing)
  // the user's manual `expanded` state — clearing the filter reverts to it.
  const isOpen = isFiltering || expanded;
  const visibleEntries = isFiltering ? entries.filter((e) => matches.has(e.id)) : entries;

  const suggestedLabels = CATEGORY_SUGGESTED_LABELS[category.slug] ?? [];
  const existingLabels = entries.map((e) => e.label);

  const handleSaveEntry = (data: any) => {
    onSaveEntry(data);
    setEditingEntryId(null);
    setAddingEntry(false);
  };

  const handleRenameSave = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== category.name) {
      onUpdateCategory({ id: category.id, name: trimmed });
    }
    setRenaming(false);
  };

  const entryActions = (entry: ContactProfileEntry) => (
    <>
      {entry.linked_note_id && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => navigate(`/dashboard/notes/${entry.linked_note_id}`)}
            >
              <LinkIcon className="h-3.5 w-3.5 text-primary" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open linked note</TooltipContent>
        </Tooltip>
      )}
      {allowPin && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onTogglePin(entry)}>
              {entry.is_pinned ? <PinOff className="h-3.5 w-3.5 text-primary" /> : <Pin className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{entry.is_pinned ? "Unpin" : "Pin"}</TooltipContent>
        </Tooltip>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingEntryId(entry.id)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive"
        onClick={() => onDeleteEntry(entry.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );



  return (
    <div id={`cat-${category.slug}`} className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 group">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={isOpen ? "Collapse section" : "Expand section"}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <ProfileIcon name={category.icon ?? "circle"} className="h-4 w-4 text-muted-foreground shrink-0" />

        {renaming ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSave();
                if (e.key === "Escape") {
                  setRenameValue(category.name);
                  setRenaming(false);
                }
              }}
              className="h-7 text-sm"
            />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRenameSave}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setRenameValue(category.name);
                setRenaming(false);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="font-medium text-sm flex-1 truncate">{category.name}</span>
        )}

        {showScope && <ScopeBadge scope={category.visibility_scope} />}
        <span className="text-xs text-muted-foreground shrink-0">{entries.length}</span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity data-[state=open]:opacity-100"
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
                setRenameValue(category.name);
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2" /> Rename category
            </DropdownMenuItem>
            {showScope && (
              <>
                <DropdownMenuSeparator />
                {SCOPE_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onSelect={() => onUpdateCategory({ id: category.id, visibility_scope: o.value })}
                  >
                    {category.visibility_scope === o.value ? (
                      <Check className="h-3.5 w-3.5 mr-2" />
                    ) : (
                      <span className="w-3.5 mr-2" />
                    )}
                    Visible to {o.label}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete category
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inline "add entry" form, revealed from the header dropdown */}
      {addingEntry && (
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <EntryForm
            categoryId={category.id}
            suggestedLabels={suggestedLabels}
            existingLabels={existingLabels}
            onSave={handleSaveEntry}
            onCancel={() => setAddingEntry(false)}
          />
        </div>
      )}

      {/* Empty-state hint: shown for a rendered-but-empty section (always a
          custom category — see isCategorySectionVisible) so there's an
          obvious path to file its first entry, instead of a silent dead end. */}
      {isOpen && !addingEntry && visibleEntries.length === 0 && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <span className="text-sm text-muted-foreground">No facts yet — add one</span>
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

      {/* Entries — grouped by canonical display label so that four
          "Name alias" rows and a comma-packed "Nickname" row collapse into a
          single bulleted "Nickname" block. */}
      {isOpen && visibleEntries.length > 0 && (
        <div className="border-t border-border">
          {groupEntriesByLabel(visibleEntries).map((group) => {
            const editing = group.items.filter((it) => it.entry.id === editingEntryId);
            const rest = group.items.filter((it) => it.entry.id !== editingEntryId);
            const editEntry = editing[0]?.entry;

            return (
              <div key={group.key}>
                {editEntry && (
                  <div className="px-4 py-3 border-b border-border">
                    <EntryForm
                      initial={editEntry}
                      categoryId={category.id}
                      suggestedLabels={suggestedLabels}
                      existingLabels={existingLabels}
                      onSave={handleSaveEntry}
                      onCancel={() => setEditingEntryId(null)}
                    />
                  </div>
                )}
                {rest.length > 0 && (
                  <ProfileRow
                    label={<Highlighted text={group.label} query={filterQuery} />}
                    actions={rest.length === 1 ? entryActions(rest[0].entry) : undefined}
                  >
                    <ProfileValue
                      label={group.label}
                      values={rest.map((it) => it.value)}
                      renderText={(t) => <Highlighted text={t} query={filterQuery} />}
                      itemActions={
                        rest.length === 1
                          ? undefined
                          : (i) => (
                              <span className="ml-auto flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                {entryActions(rest[i].entry)}
                              </span>
                            )
                      }
                    />
                  </ProfileRow>
                )}
              </div>
            );
          })}
        </div>
      )}


      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{category.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {entries.length > 0
                ? `This will also delete ${entries.length} entr${entries.length === 1 ? "y" : "ies"} in this category.`
                : "This category has no entries."}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDeleteCategory(category.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
