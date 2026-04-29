import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Database, Json } from "@/integrations/supabase/types";

type Template = Database["public"]["Tables"]["collection_templates"]["Row"];
type FieldType =
  | "text"
  | "longtext"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "url"
  | "email"
  | "phone"
  | "link_note"
  | "link_person"
  | "link_collection_item";

type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  indexable?: boolean;
  options?: string[];
  target_collection_slug?: string | null;
};

const categories = ["All", "Home", "Work", "Personal", "Health", "Creative"];

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
}

function parseFields(value: Json): TemplateField[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, Json | undefined> : {};
    const label = typeof item.label === "string" ? item.label : `Field ${index + 1}`;
    return {
      key: typeof item.key === "string" ? item.key : slugify(label).replace(/-/g, "_"),
      label,
      type: typeof item.type === "string" ? item.type as FieldType : "text",
      primary: item.primary === true,
      indexable: item.indexable === true,
      options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string") : undefined,
      target_collection_slug: typeof item.target_collection_slug === "string" ? item.target_collection_slug : null,
    };
  });
}

function formatUsage(value: number) {
  if (!value) return "";
  if (value >= 1_000_000) return `Used ${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M times`;
  if (value >= 1_000) return `Used ${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k times`;
  return `Used ${value} time${value === 1 ? "" : "s"}`;
}

function TemplateSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader className="space-y-3">
            <Skeleton className="h-12 w-12 rounded-md" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardHeader>
          <CardFooter className="gap-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-24" /></CardFooter>
        </Card>
      ))}
    </div>
  );
}

function FieldPreview({ field }: { field: TemplateField }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{field.label}</span>
          <Badge variant="outline">{field.type.replace(/_/g, " ")}</Badge>
          {field.primary && <Badge variant="secondary">Primary</Badge>}
          {field.indexable && <Badge variant="secondary">Indexable</Badge>}
        </div>
        {field.options?.length ? <p className="mt-2 text-xs text-muted-foreground">{field.options.join(", ")}</p> : null}
      </CardContent>
    </Card>
  );
}

function TemplateCard({ template, onClick }: { template: Template; onClick: () => void }) {
  const fields = parseFields(template.field_schema);
  const usage = formatUsage(template.usage_count);
  return (
    <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={onClick}>
      <CardHeader>
        <div className="mb-2 text-4xl" aria-hidden="true">{template.icon || "📁"}</div>
        <CardTitle className="text-base">{template.name}</CardTitle>
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{template.description || "No description"}</p>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{fields.length} field{fields.length === 1 ? "" : "s"}</span>
        {usage && <span>{usage}</span>}
      </CardFooter>
    </Card>
  );
}

function ConfirmCreateDialog({ template, open, onOpenChange }: { template: Template | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (template && open) setName(template.name);
  }, [open, template]);

  const create = async () => {
    if (!user || !template || !name.trim()) return;
    setIsCreating(true);
    const slug = slugify(name);
    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: name.trim(),
        slug,
        icon: template.icon,
        description: template.description,
        visibility: "private",
        field_schema: template.field_schema,
        agent_instructions: template.agent_instructions,
      })
      .select("slug")
      .single();

    if (!error) await supabase.rpc("increment_collection_template_usage", { p_slug: template.slug });
    setIsCreating(false);

    if (error || !data) {
      toast.error("Could not create collection", { description: "Please try again." });
      return;
    }

    toast.success("Collection created");
    onOpenChange(false);
    navigate(`/collections/${data.slug}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Use This Template</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="template-collection-name">Collection name</Label>
          <Input id="template-collection-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="My Books" />
          <p className="text-xs text-muted-foreground">URL: menerio.com/collections/{slugify(name)}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={isCreating} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || isCreating} onClick={create}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CollectionTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("collection_templates")
        .select("*")
        .order("official", { ascending: false })
        .order("usage_count", { ascending: false })
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        toast.error("Could not load templates", { description: error.message });
        setIsLoading(false);
        return;
      }
      setTemplates(data ?? []);
      setIsLoading(false);
    };
    loadTemplates();
    return () => { cancelled = true; };
  }, []);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === "All") return templates;
    return templates.filter((template) => template.category?.toLowerCase() === selectedCategory.toLowerCase());
  }, [selectedCategory, templates]);

  const selectedFields = selectedTemplate ? parseFields(selectedTemplate.field_schema) : [];

  return (
    <div className="w-full max-w-6xl">
      <SEOHead title="Collection Templates — Menerio" noIndex />
      <div className="mb-6 space-y-5">
        <div className="space-y-2">
          <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate("/collections")}>Collections / Templates</button>
          <h1 className="text-2xl font-bold font-display">Collection Templates</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Pre-built schemas you can use as a starting point. Click to preview, then customize before saving.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button key={category} type="button" variant={selectedCategory === category ? "default" : "secondary"} size="sm" onClick={() => setSelectedCategory(category)}>
              {category}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <TemplateSkeleton />
      ) : templates.length === 0 ? (
        <div className="flex min-h-[45vh] items-center justify-center text-center">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary"><LayoutGrid className="h-6 w-6" /></div>
            <h2 className="font-semibold">No templates yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">Templates will appear here once they are added.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((template) => <TemplateCard key={template.id} template={template} onClick={() => { setSelectedTemplate(template); setInstructionsOpen(false); }} />)}
        </div>
      )}

      <Sheet open={!!selectedTemplate} onOpenChange={(open) => { if (!open) setSelectedTemplate(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedTemplate && (
            <>
              <SheetHeader className="text-left">
                <div className="flex items-start gap-3">
                  <div className="text-4xl" aria-hidden="true">{selectedTemplate.icon || "📁"}</div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle>{selectedTemplate.name}</SheetTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {selectedTemplate.category && <Badge variant="secondary">{selectedTemplate.category}</Badge>}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{selectedTemplate.description}</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Fields</h3>
                  <div className="space-y-2">{selectedFields.map((field) => <FieldPreview key={field.key} field={field} />)}</div>
                </section>

                <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen} className="space-y-2">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full items-center justify-between text-sm font-medium">
                      How AI captures into this
                      <ChevronDown className={cn("h-4 w-4 transition-transform", instructionsOpen && "rotate-180")} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Textarea readOnly value={selectedTemplate.agent_instructions || ""} className="min-h-32 resize-none" />
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <SheetFooter className="mt-6 flex-row justify-end gap-2 sm:space-x-0">
                <Button type="button" variant="ghost" onClick={() => setSelectedTemplate(null)}>Cancel</Button>
                <Button type="button" onClick={() => setConfirmOpen(true)}>Use This Template</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmCreateDialog template={selectedTemplate} open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) setSelectedTemplate(null); }} />
    </div>
  );
}
