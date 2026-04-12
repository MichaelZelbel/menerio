import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySection } from "@/components/profile/CategorySection";
import { ProfileCompleteness } from "@/components/profile/ProfileCompleteness";
import { SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { CATEGORY_SUGGESTED_LABELS } from "@/lib/profile-suggestions";
import { useContactProfile } from "@/hooks/useContactProfile";
import { PageLoader } from "@/components/LoadingStates";

interface ContactProfileTabProps {
  contactId: string;
  contactName: string;
}

export function ContactProfileTab({ contactId, contactName }: ContactProfileTabProps) {
  const {
    categories,
    entries,
    isLoading,
    seedDefaults,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
  } = useContactProfile(contactId);

  const [seeded, setSeeded] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("folder");
  const [newCatScope, setNewCatScope] = useState("all");

  // Seed defaults on first visit
  useEffect(() => {
    if (!isLoading && categories.length === 0 && !seeded) {
      setSeeded(true);
      seedDefaults.mutate();
    }
  }, [isLoading, categories.length, seeded]);

  if (isLoading) return <PageLoader />;

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground mb-3">
          Setting up {contactName}'s profile…
        </p>
        <Button onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending} size="sm">
          Initialize Profile
        </Button>
      </div>
    );
  }

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    const slug = newCatName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    upsertCategory.mutate({
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

  // Find the "neediest" category (fewest entries)
  const neediestId = [...categories]
    .sort((a, b) => {
      const aCount = entries.filter((e) => e.category_id === a.id).length;
      const bCount = entries.filter((e) => e.category_id === b.id).length;
      if (aCount !== bCount) return aCount - bCount;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })[0]?.id;

  return (
    <div className="space-y-3">
      <ProfileCompleteness categories={categories} entries={entries} />

      {categories.map((cat) => (
        <CategorySection
          key={cat.id}
          category={cat}
          entries={entries.filter((e) => e.category_id === cat.id)}
          defaultExpanded={cat.id === neediestId}
          onSaveEntry={(data) => upsertEntry.mutate(data)}
          onDeleteEntry={(id) => deleteEntry.mutate(id)}
          onUpdateCategory={(data) => upsertCategory.mutate(data)}
          onDeleteCategory={(id) => deleteCategory.mutate(id)}
        />
      ))}

      {addingCategory ? (
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
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAddingCategory(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddCategory} disabled={!newCatName.trim()}>Add</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setAddingCategory(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add custom category
        </Button>
      )}
    </div>
  );
}
