import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Pencil, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

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

type GeneratedField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  indexable?: boolean;
  options?: string[];
  target_collection_slug?: string;
};

type GeneratedSchema = {
  collection: {
    name: string;
    icon: string;
    description: string;
    visibility: "private" | "personal";
  };
  field_schema: GeneratedField[];
  agent_instructions: string;
};

type EdgeField = Omit<GeneratedField, "id">;

type EdgeResponse = {
  collection: GeneratedSchema["collection"];
  field_schema: EdgeField[];
  agent_instructions: string;
};

const placeholders = [
  "I want to track all the books I'm reading, with status and tags...",
  "I want to log my workouts — date, type, duration, how I felt...",
  "I want to track potential clients I meet at conferences...",
  "I want to capture interesting wines I drink, where I had them, and what I thought...",
];

const examples = [
  { label: "📚 Reading list", value: "I want to track all the books I'm reading, whether I want to read, am reading, or finished them, plus tags and notes." },
  { label: "💪 Workouts", value: "I want to log my workouts — date, type, duration, intensity, and how I felt afterward." },
  { label: "🍷 Wine journal", value: "I want to capture interesting wines I drink, where I had them, grape or region, and what I thought." },
  { label: "🎯 Sales leads", value: "I want to track potential clients I meet at conferences, what they need, follow-up status, and next steps." },
];

const fieldTypes: FieldType[] = [
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
  "link_note",
  "link_person",
  "link_collection_item",
];

const optionTypes = new Set<FieldType>(["select", "multiselect"]);
const indexableTypes = new Set<FieldType>(["date", "number", "select"]);

function slugify(value: string, separator = "-") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, separator).replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "") || "collection";
}

function toFieldKey(label: string) {
  return slugify(label, "_");
}

function withIds(fields: EdgeField[]): GeneratedField[] {
  return fields.map((field) => ({ ...field, id: crypto.randomUUID() }));
}

function toJsonSchema(fields: GeneratedField[]): Json[] {
  return fields.map(({ id: _id, ...field }) => {
    const clean: Record<string, Json> = {
      key: field.key,
      label: field.label,
      type: field.type,
    };
    if (field.primary) clean.primary = true;
    if (field.indexable) clean.indexable = true;
    if (optionTypes.has(field.type)) clean.options = field.options ?? [];
    if (field.type === "link_collection_item" && field.target_collection_slug) clean.target_collection_slug = field.target_collection_slug;
    return clean;
  });
}

function normalizeGenerated(response: EdgeResponse): GeneratedSchema {
  return {
    collection: {
      name: response.collection.name || "New Collection",
      icon: response.collection.icon || "✨",
      description: response.collection.description || "",
      visibility: response.collection.visibility === "private" ? "private" : "personal",
    },
    field_schema: withIds(response.field_schema ?? []),
    agent_instructions: response.agent_instructions || "",
  };
}

function FieldEditPopover({ field, onChange }: { field: GeneratedField; onChange: (field: GeneratedField) => void }) {
  const [optionDraft, setOptionDraft] = useState("");
  const updateType = (type: FieldType) => {
    onChange({
      ...field,
      type,
      indexable: indexableTypes.has(type) ? field.indexable : false,
      options: optionTypes.has(type) ? (field.options?.length ? field.options : ["Option"]) : undefined,
      target_collection_slug: type === "link_collection_item" ? field.target_collection_slug : undefined,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Edit field">
          <Pencil className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-2">
          <Label>Label</Label>
          <Input value={field.label} onChange={(event) => onChange({ ...field, label: event.target.value, key: toFieldKey(event.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={field.type} onValueChange={(value) => updateType(value as FieldType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {fieldTypes.map((type) => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {field.type === "link_collection_item" && (
          <div className="space-y-2">
            <Label>Target collection slug</Label>
            <Input value={field.target_collection_slug ?? ""} onChange={(event) => onChange({ ...field, target_collection_slug: slugify(event.target.value) })} placeholder="books" />
          </div>
        )}
        {optionTypes.has(field.type) && (
          <div className="space-y-2">
            <Label>Options</Label>
            <div className="flex flex-wrap gap-2">
              {(field.options ?? []).map((option, index) => (
                <Badge key={`${option}-${index}`} variant="secondary" className="gap-1">
                  {option}
                  <button type="button" aria-label={`Remove ${option}`} onClick={() => onChange({ ...field, options: field.options?.filter((_, optionIndex) => optionIndex !== index) })}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={optionDraft} onChange={(event) => setOptionDraft(event.target.value)} placeholder="Add option" />
              <Button type="button" variant="secondary" onClick={() => { const next = optionDraft.trim(); if (next) onChange({ ...field, options: [...(field.options ?? []), next] }); setOptionDraft(""); }}>Add</Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={field.primary ? "default" : "outline"} size="sm" onClick={() => onChange({ ...field, primary: !field.primary })}>Primary</Button>
          {indexableTypes.has(field.type) && <Button type="button" variant={field.indexable ? "default" : "outline"} size="sm" onClick={() => onChange({ ...field, indexable: !field.indexable })}>Indexable</Button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AICollectionDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [stage, setStage] = useState<"input" | "preview">("input");
  const [description, setDescription] = useState("");
  const [generated, setGenerated] = useState<GeneratedSchema | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [refinement, setRefinement] = useState("");
  const [dirtyGenerated, setDirtyGenerated] = useState(false);

  useEffect(() => {
    if (!open || stage !== "input" || description.trim()) return;
    const timer = window.setInterval(() => setPlaceholderIndex((current) => (current + 1) % placeholders.length), 4000);
    return () => window.clearInterval(timer);
  }, [description, open, stage]);

  const canGenerate = description.trim().length >= 10 && !isGenerating;
  const hasPreview = stage === "preview" && generated;

  const updateTextareaHeight = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  };

  const requestSchema = async (prompt: string, refining = false) => {
    if (!user) return;
    refining ? setIsRefining(true) : setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke<EdgeResponse>("generate_collection_schema", {
        body: { description: prompt },
      });
      if (error || !data) throw error ?? new Error("No schema returned");
      setGenerated(normalizeGenerated(data));
      setStage("preview");
      setDirtyGenerated(true);
    } catch (error) {
      toast.error("Could not generate collection", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setIsGenerating(false);
      setIsRefining(false);
    }
  };

  const reset = () => {
    setStage("input");
    setDescription("");
    setGenerated(null);
    setIsGenerating(false);
    setIsRefining(false);
    setIsSaving(false);
    setInstructionsOpen(false);
    setEditingInstructions(false);
    setRefinement("");
    setDirtyGenerated(false);
  };

  const close = (next: boolean) => {
    if (!next && dirtyGenerated && !window.confirm("Discard this generated collection?")) return;
    onOpenChange(next);
    if (!next) reset();
  };

  const updateGenerated = (updater: (current: GeneratedSchema) => GeneratedSchema) => {
    setGenerated((current) => current ? updater(current) : current);
    setDirtyGenerated(true);
  };

  const updateField = (field: GeneratedField) => {
    updateGenerated((current) => {
      const nextFields = current.field_schema.map((item) => item.id === field.id ? field : item);
      const primaryCount = nextFields.filter((item) => item.primary).length;
      return { ...current, field_schema: primaryCount > 1 ? nextFields.map((item) => ({ ...item, primary: item.id === field.id })) : nextFields };
    });
  };

  const addField = () => {
    updateGenerated((current) => ({
      ...current,
      field_schema: [...current.field_schema, { id: crypto.randomUUID(), key: "new_field", label: "New field", type: "text", primary: current.field_schema.length === 0 }],
    }));
  };

  const removeField = (id: string) => {
    updateGenerated((current) => {
      const fields = current.field_schema.filter((field) => field.id !== id);
      if (!fields.some((field) => field.primary) && fields[0]) fields[0].primary = true;
      return { ...current, field_schema: fields };
    });
  };

  const sendRefinement = async () => {
    const message = refinement.trim();
    if (!message || isRefining) return;
    setRefinement("");
    await requestSchema(`${description}\n\nRefinement: ${message}`, true);
  };

  const saveCollection = async () => {
    if (!user || !generated || generated.field_schema.length === 0) return;
    if (generated.field_schema.filter((field) => field.primary).length !== 1) {
      toast.error("Choose exactly one primary field");
      return;
    }
    setIsSaving(true);
    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: generated.collection.name.trim(),
        slug: slugify(generated.collection.name),
        icon: generated.collection.icon || null,
        description: generated.collection.description || null,
        visibility: generated.collection.visibility,
        field_schema: toJsonSchema(generated.field_schema),
        agent_instructions: generated.agent_instructions,
      })
      .select("slug")
      .single();
    setIsSaving(false);
    if (error || !data) {
      toast.error("Could not save collection", { description: "Please try again." });
      return;
    }
    toast.success("Collection created");
    setDirtyGenerated(false);
    onOpenChange(false);
    reset();
    onCreated?.();
    navigate(`/collections/${data.slug}`);
  };

  const titleId = stage === "input" ? "Create a collection with AI" : "Preview AI collection";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleId}</DialogTitle>
          {stage === "input" && <p className="text-sm text-muted-foreground">Describe what you want to track in one sentence. Menerio will design the schema for you.</p>}
        </DialogHeader>

        {stage === "input" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Textarea
                ref={textareaRef}
                rows={5}
                value={description}
                disabled={isGenerating}
                placeholder={placeholders[placeholderIndex]}
                className="max-h-60 min-h-32 resize-none text-base"
                onChange={(event) => { setDescription(event.target.value); requestAnimationFrame(updateTextareaHeight); }}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate) requestSchema(description); }}
              />
              <p className="text-xs text-muted-foreground">Your description is sent to our AI provider only to design the schema. It's not used to train any model.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {examples.map((example) => (
                <Button key={example.label} type="button" variant="secondary" size="sm" disabled={isGenerating} onClick={() => setDescription(example.value)}>
                  {example.label}
                </Button>
              ))}
            </div>
            {isGenerating && (
              <div className="overflow-hidden rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                <div className="animate-pulse">Designing your schema...</div>
                <div className="mt-2 h-1 w-full rounded-full bg-muted"><div className="h-1 w-1/2 animate-pulse rounded-full bg-primary/50" /></div>
              </div>
            )}
          </div>
        )}

        {hasPreview && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Your Collection</h3>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-[4rem_1fr]">
                    <Input aria-label="Collection icon" value={generated.collection.icon} maxLength={4} onChange={(event) => updateGenerated((current) => ({ ...current, collection: { ...current.collection, icon: event.target.value } }))} />
                    <Input value={generated.collection.name} onChange={(event) => updateGenerated((current) => ({ ...current, collection: { ...current.collection, name: event.target.value } }))} />
                  </div>
                  <Textarea value={generated.collection.description} onChange={(event) => updateGenerated((current) => ({ ...current, collection: { ...current.collection, description: event.target.value } }))} />
                </CardContent>
              </Card>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Fields</h3>
              <div className="space-y-2">
                {generated.field_schema.map((field) => (
                  <Card key={field.id}>
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{field.label}</span>
                          <Badge variant="outline">{field.type.replaceAll("_", " ")}</Badge>
                          {field.primary && <Badge variant="secondary">Primary</Badge>}
                          {field.indexable && <Badge variant="secondary">Indexable</Badge>}
                        </div>
                        {optionTypes.has(field.type) && field.options?.length ? <p className="mt-2 text-xs text-muted-foreground">{field.options.join(", ")}</p> : null}
                      </div>
                      <FieldEditPopover field={field} onChange={updateField} />
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove field" onClick={() => removeField(field.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button type="button" variant="outline" onClick={addField}>+ Add field</Button>
            </section>

            <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen} className="space-y-2">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between text-sm font-medium">
                  How AI will capture into this
                  <ChevronDown className={cn("h-4 w-4 transition-transform", instructionsOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2">
                <p className="text-xs text-muted-foreground">This tells your AI assistants how to detect mentions and capture entries automatically.</p>
                <div className="flex justify-end">
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setEditingInstructions((current) => !current)}>Edit</Button>
                </div>
                <Textarea readOnly={!editingInstructions} value={generated.agent_instructions} className="min-h-28" onChange={(event) => updateGenerated((current) => ({ ...current, agent_instructions: event.target.value }))} />
              </CollapsibleContent>
            </Collapsible>

            <div className="flex items-center gap-2 rounded-md border p-2">
              <Input
                value={refinement}
                disabled={isRefining}
                placeholder="Ask AI to refine — e.g. 'add a field for which language they spoke'"
                onChange={(event) => setRefinement(event.target.value)}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendRefinement(); }}
              />
              <Button type="button" size="icon" disabled={!refinement.trim() || isRefining} onClick={sendRefinement} aria-label="Send refinement">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {isRefining && <p className="text-xs text-muted-foreground">refining...</p>}
          </div>
        )}

        <DialogFooter>
          {stage === "input" ? (
            <>
              <Button type="button" variant="ghost" disabled={isGenerating} onClick={() => close(false)}>Cancel</Button>
              <Button type="button" disabled={!canGenerate} onClick={() => requestSchema(description)}>
                <Sparkles className="mr-2 h-4 w-4" /> Generate
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={isSaving} onClick={() => setStage("input")}>Back</Button>
              <Button type="button" disabled={!generated?.field_schema.length || isSaving || isRefining} onClick={saveCollection}>Save Collection</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
