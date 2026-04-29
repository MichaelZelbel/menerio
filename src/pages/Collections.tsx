import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { AICollectionDialog } from "@/components/collections/AICollectionDialog";

type Collection = Database["public"]["Tables"]["collections"]["Row"];
type CollectionWithCount = Collection & { itemCount: number };

const iconMap: Record<string, LucideIcon> = { LayoutGrid, Sparkles };
const emojiOptions = ["📚", "🏠", "💼", "🎯", "🍳", "✏️", "🎨", "💡", "🔧", "🌱"];
const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name must be 60 characters or fewer"),
  icon: z.string().trim().refine((value) => !value || (/^\p{Emoji}/u.test(value) && Array.from(value.replace(/\uFE0F/g, "")).length === 1), "Use a single emoji"),
  description: z.string().trim().max(200, "Description must be 200 characters or fewer").optional(),
  visibility: z.enum(["private", "personal"]),
});

type CollectionFormValues = z.infer<typeof collectionFormSchema>;
type CollectionFormErrors = Partial<Record<keyof CollectionFormValues, string>>;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
}

function CollectionIcon({ icon, className = "h-5 w-5" }: { icon?: string | null; className?: string }) {
  if (icon && /^\p{Emoji}/u.test(icon)) return <span className={className}>{icon}</span>;
  const Icon = icon && icon in iconMap ? iconMap[icon] : LayoutGrid;
  return <Icon className={className} />;
}

function CollectionsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyCollectionsState({ onNewBlank, onCreateWithAI }: { onNewBlank: () => void; onCreateWithAI: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16 text-center">
      <div className="max-w-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary">
          <LayoutGrid className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold font-display">No collections yet</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Collections are structured trackers for anything you want to remember — household items, reading lists, contacts, job applications. Create one from a template or describe what you want to track.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="secondary">Browse Templates</Button>
          <Button size="lg" className="animate-pulse bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95" onClick={onCreateWithAI}>
            ✨ Create with AI
          </Button>
        </div>
        <button type="button" className="mt-4 text-sm text-primary underline-offset-4 hover:underline" onClick={onNewBlank}>
          or create a blank collection
        </button>
      </div>
    </div>
  );
}

function CollectionCard({ collection }: { collection: CollectionWithCount }) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={() => navigate(`/collections/${collection.slug}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <CollectionIcon icon={collection.icon} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{collection.name}</CardTitle>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
              {collection.description || "No description"}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {collection.itemCount} item{collection.itemCount === 1 ? "" : "s"}
        </p>
      </CardContent>
    </Card>
  );
}

function NewCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<CollectionFormValues>({ name: "", icon: "📚", description: "", visibility: "private" });
  const [errors, setErrors] = useState<CollectionFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const slugPreview = slugify(values.name);

  const updateValue = <K extends keyof CollectionFormValues>(key: K, value: CollectionFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = () => {
    const parsed = collectionFormSchema.safeParse(values);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }

    const nextErrors: CollectionFormErrors = {};
    parsed.error.issues.forEach((issue) => {
      const key = issue.path[0] as keyof CollectionFormValues | undefined;
      if (key) nextErrors[key] = issue.message;
    });
    setErrors(nextErrors);
    return null;
  };

  const reset = () => {
    setValues({ name: "", icon: "📚", description: "", visibility: "private" });
    setErrors({});
    setIsSubmitting(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const parsed = validate();
    if (!parsed) return;

    setIsSubmitting(true);
    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: parsed.name,
        slug: slugPreview,
        icon: parsed.icon || null,
        description: parsed.description || null,
        visibility: parsed.visibility,
        field_schema: [],
        agent_instructions: null,
      })
      .select("slug")
      .single();

    setIsSubmitting(false);
    if (error || !data) {
      toast.error("Could not create collection", { description: "Please try again." });
      return;
    }

    toast.success("Collection created");
    onOpenChange(false);
    reset();
    navigate(`/collections/${data.slug}/schema`);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Collection</DialogTitle></DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input id="collection-name" value={values.name} maxLength={60} onChange={(event) => updateValue("name", event.target.value)} onBlur={validate} placeholder="Reading List" />
            <p className="text-xs text-muted-foreground">Slug: {slugPreview}</p>
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {emojiOptions.map((emoji) => (
                <button key={emoji} type="button" className={cn("flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors hover:bg-accent", values.icon === emoji && "border-primary bg-primary/10")} onClick={() => updateValue("icon", emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
            <Input value={values.icon} maxLength={4} onChange={(event) => updateValue("icon", event.target.value)} onBlur={validate} className="w-24" aria-label="Custom emoji" />
            {errors.icon && <p className="text-xs text-destructive">{errors.icon}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-description">Description</Label>
            <Textarea id="collection-description" value={values.description} maxLength={200} onChange={(event) => updateValue("description", event.target.value)} onBlur={validate} placeholder="What does this collection track?" />
            {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <RadioGroup value={values.visibility} onValueChange={(value) => updateValue("visibility", value as "private" | "personal")}>
              <Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="private" /> Private (only me)</Label>
              <Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="personal" /> Personal (visible to my AI agents)</Label>
            </RadioGroup>
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">URL: menerio.com/collections/{slugPreview}</p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!values.name.trim() || isSubmitting}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Collections() {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const fetchCollections = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        if (!cancelled) {
          toast.error("Could not load collections", { description: error.message });
          setIsLoading(false);
        }
        return;
      }

      const rows = data ?? [];
      const counts = await Promise.all(
        rows.map(async (collection) => {
          const { count, error: countError } = await supabase
            .from("collection_items")
            .select("id", { count: "exact", head: true })
            .eq("collection_id", collection.id)
            .eq("user_id", user.id);

          if (countError) throw countError;
          return [collection.id, count ?? 0] as const;
        }),
      ).catch((countError: Error) => {
        if (!cancelled) toast.error("Could not load item counts", { description: countError.message });
        return [] as readonly (readonly [string, number])[];
      });

      const countById = new Map(counts);
      if (!cancelled) {
        setCollections(rows.map((collection) => ({ ...collection, itemCount: countById.get(collection.id) ?? 0 })));
        setIsLoading(false);
      }
    };

    fetchCollections();
    return () => { cancelled = true; };
  }, [user, refreshKey]);

  const hasCollections = useMemo(() => collections.length > 0, [collections.length]);

  return (
    <div className="w-full max-w-6xl">
      <SEOHead title="Collections — Menerio" noIndex />
      {hasCollections && (
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold font-display">Collections</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm">Templates</Button>
            <Button size="sm" className="bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95" onClick={() => setAiDialogOpen(true)}>✨ Create with AI</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="New blank collection" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New blank collection</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {isLoading ? (
        <CollectionsSkeleton />
      ) : collections.length === 0 ? (
        <EmptyCollectionsState onNewBlank={() => setDialogOpen(true)} onCreateWithAI={() => setAiDialogOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}
        </div>
      )}
      <NewCollectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <AICollectionDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} onCreated={() => setRefreshKey((key) => key + 1)} />
    </div>
  );
}