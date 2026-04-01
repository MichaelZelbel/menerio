import { useEffect, useState } from "react";
import { User, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEOHead } from "@/components/SEOHead";
import { useProfile } from "@/hooks/useProfile";
import { CategorySection } from "@/components/profile/CategorySection";
import { AgentInstructionsTab } from "@/components/profile/AgentInstructionsTab";
import { ExportTab } from "@/components/profile/ExportTab";
import { ProfileSuggestions } from "@/components/profile/ProfileSuggestions";
import { SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { PageLoader } from "@/components/LoadingStates";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function Profile() {
  const {
    categories,
    entries,
    instructions,
    views,
    isLoading,
    seedDefaults,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
    upsertInstruction,
    deleteInstruction,
    upsertView,
    deleteView,
  } = useProfile();

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

  // Welcome state while seeding
  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <User className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold mb-2">Build your personal profile</h1>
        <p className="text-muted-foreground max-w-md mb-6">
          Help AI agents understand who you are. Fill in what matters to you — everything is optional, and you can add your own categories anytime.
        </p>
        <Button onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
          Get Started
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

  return (
    <>
      <SEOHead title="My Profile — Menerio" description="Your personal profile for AI agents" />
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">My Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your personal context layer for AI agents. Fill in what matters — everything is optional.
          </p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="instructions">Agent Instructions</TabsTrigger>
            <TabsTrigger value="export">Export & Share</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-3 mt-4">
            {categories.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                entries={entries.filter((e) => e.category_id === cat.id)}
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
          </TabsContent>

          <TabsContent value="instructions" className="mt-4">
            <AgentInstructionsTab
              instructions={instructions}
              onSave={(data) => upsertInstruction.mutate(data)}
              onDelete={(id) => deleteInstruction.mutate(id)}
            />
          </TabsContent>

          <TabsContent value="export" className="mt-4">
            <ExportTab
              categories={categories}
              entries={entries}
              instructions={instructions}
              views={views}
              onSaveView={(data) => upsertView.mutate(data)}
              onDeleteView={(id) => deleteView.mutate(id)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
