import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Link, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ProfileIcon } from "./ProfileIcon";
import { ScopeBadge, SCOPE_OPTIONS } from "./ScopeBadge";
import { EntryForm } from "./EntryForm";
import type { ProfileCategory, ProfileEntry } from "@/hooks/useProfile";
import { useNavigate } from "react-router-dom";

interface CategorySectionProps {
  category: ProfileCategory;
  entries: ProfileEntry[];
  onSaveEntry: (data: any) => void;
  onDeleteEntry: (id: string) => void;
  onUpdateCategory: (data: Partial<ProfileCategory> & { id: string }) => void;
  onDeleteCategory: (id: string) => void;
}

export function CategorySection({
  category,
  entries,
  onSaveEntry,
  onDeleteEntry,
  onUpdateCategory,
  onDeleteCategory,
}: CategorySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [editIcon, setEditIcon] = useState(category.icon ?? "circle");
  const [editScope, setEditScope] = useState(category.visibility_scope);
  const navigate = useNavigate();

  const handleSaveEntry = (data: any) => {
    onSaveEntry(data);
    setAddingEntry(false);
    setEditingEntryId(null);
  };

  const handleSaveSettings = () => {
    onUpdateCategory({ id: category.id, name: editName, icon: editIcon, visibility_scope: editScope });
    setShowSettings(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer group hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <ProfileIcon name={category.icon ?? "circle"} className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm flex-1">{category.name}</span>
        <ScopeBadge scope={category.visibility_scope} />
        <span className="text-xs text-muted-foreground">{entries.length}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
            setEditName(category.name);
            setEditIcon(category.icon ?? "circle");
            setEditScope(category.visibility_scope);
          }}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-t border-border bg-muted/30 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Icon (Lucide name)</label>
              <Input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} className="text-sm" placeholder="e.g. heart" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Visibility</label>
              <Select value={editScope} onValueChange={setEditScope}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete category
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{category.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {entries.length > 0
                      ? `This will also delete ${entries.length} entr${entries.length === 1 ? "y" : "ies"} in this category.`
                      : "This category has no entries."}
                    {" "}This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDeleteCategory(category.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveSettings}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Entries */}
      {expanded && (
        <div className="border-t border-border">
          {entries.length === 0 && !addingEntry && (
            <p className="px-4 py-4 text-sm text-muted-foreground italic">
              No entries yet — click + to add one
            </p>
          )}
          {entries.map((entry) =>
            editingEntryId === entry.id ? (
              <div key={entry.id} className="px-4 py-3 border-b border-border last:border-b-0">
                <EntryForm
                  initial={entry}
                  categoryId={category.id}
                  onSave={handleSaveEntry}
                  onCancel={() => setEditingEntryId(null)}
                />
              </div>
            ) : (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0 group/entry hover:bg-accent/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{entry.label}</p>
                  <p className="text-sm mt-0.5 whitespace-pre-wrap">{entry.value}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/entry:opacity-100 transition-opacity">
                  {entry.linked_note_id && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => navigate(`/dashboard/notes/${entry.linked_note_id}`)}
                        >
                          <Link className="h-3.5 w-3.5 text-primary" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open linked note</TooltipContent>
                    </Tooltip>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingEntryId(entry.id)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDeleteEntry(entry.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          )}

          {addingEntry ? (
            <div className="px-4 py-3">
              <EntryForm
                categoryId={category.id}
                onSave={handleSaveEntry}
                onCancel={() => setAddingEntry(false)}
              />
            </div>
          ) : (
            <div className="px-4 py-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setAddingEntry(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add entry
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
