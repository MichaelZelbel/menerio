import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { Check, ChevronLeft, ChevronRight, ExternalLink, LayoutGrid, MoreHorizontal, Plus, Search } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Database, Json } from "@/integrations/supabase/types";

type Collection = Database["public"]["Tables"]["collections"]["Row"];
type CollectionItem = Database["public"]["Tables"]["collection_items"]["Row"];
type FieldType = "text" | "longtext" | "number" | "date" | "datetime" | "boolean" | "select" | "multiselect" | "currency" | "url" | "email" | "phone" | "note" | "person" | "collection" | "link_note" | "link_person" | "link_collection_item";
type SchemaField = { key: string; label: string; type: FieldType; primary?: boolean; options?: string[] };
type ItemData = Record<string, unknown>;
type Cursor = { updated_at: string; id: string };
type SortKey = "updated" | "created" | "alpha";

const PAGE_SIZE = 50;
const emojiOptions = ["📚", "🏠", "💼", "🎯", "🍳", "✏️", "🎨", "💡", "🔧", "🌱"];
const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name must be 60 characters or fewer"),
  icon: z.string().trim().refine((value) => !value || (/^\p{Emoji}/u.test(value) && Array.from(value.replace(/\uFE0F/g, "")).length === 1), "Use a single emoji"),
  description: z.string().trim().max(200, "Description must be 200 characters or fewer").optional(),
  visibility: z.enum(["private", "personal"]),
});

function parseSchema(value: Json): SchemaField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, Json | undefined>;
    if (typeof item.key !== "string" || typeof item.label !== "string" || typeof item.type !== "string") return [];
    return [{ key: item.key, label: item.label, type: item.type as FieldType, primary: item.primary === true, options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string") : undefined }];
  });
}

function asData(value: Json): ItemData {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ItemData : {};
}

function truncate(value: unknown, length = 60) {
  const text = value == null ? "" : String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : new Date(String(value));
  return isValid(date) ? date : null;
}

function renderDate(value: unknown) {
  const date = parseDate(value);
  if (!date) return "—";
  const age = Math.abs(Date.now() - date.getTime());
  return age <= 7 * 24 * 60 * 60 * 1000 ? formatDistanceToNow(date, { addSuffix: true }) : format(date, "MMM d, yyyy");
}

function optionClass(value: string) {
  const variants = ["border-primary/30 bg-primary/10 text-primary", "border-accent/40 bg-accent text-accent-foreground", "border-secondary bg-secondary text-secondary-foreground", "border-muted bg-muted text-muted-foreground"];
  const index = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0) % variants.length;
  return variants[index];
}

function FieldValue({ field, value }: { field: SchemaField; value: unknown }) {
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>;
  if (field.type === "number") return <span className="block text-right tabular-nums">{Number(value).toLocaleString()}</span>;
  if (field.type === "currency") return <span className="block text-right tabular-nums">{Number(value).toLocaleString(undefined, { style: "currency", currency: "USD" })}</span>;
  if (field.type === "date" || field.type === "datetime") return <span>{renderDate(value)}</span>;
  if (field.type === "boolean") return value ? <Check className="h-4 w-4 text-primary" /> : <span />;
  if (field.type === "select") return <Badge variant="outline" className={cn("max-w-40 truncate", optionClass(String(value)))}>{String(value)}</Badge>;
  if (field.type === "multiselect") {
    const values = Array.isArray(value) ? value : [value];
    return <div className="flex max-w-64 flex-wrap gap-1">{values.map((item) => <Badge key={String(item)} variant="outline" className={cn("text-[10px]", optionClass(String(item)))}>{String(item)}</Badge>)}</div>;
  }
  if (field.type === "url") return <a href={String(value)} target="_blank" rel="noreferrer" className="inline-flex max-w-60 items-center gap-1 truncate text-primary hover:underline">{truncate(value)}<ExternalLink className="h-3 w-3" /></a>;
  if (field.type === "email") return <a href={`mailto:${String(value)}`} className="max-w-60 truncate text-primary hover:underline">{truncate(value)}</a>;
  if (field.type === "phone") return <a href={`tel:${String(value)}`} className="max-w-60 truncate text-primary hover:underline">{truncate(value)}</a>;
  if (["note", "person", "collection", "link_note", "link_person", "link_collection_item"].includes(field.type)) return <Badge variant="secondary" className="max-w-48 truncate">{String(value)}</Badge>;
  return <span className="block max-w-80 truncate">{truncate(value)}</span>;
}

function CollectionIcon({ icon, className = "h-5 w-5" }: { icon?: string | null; className?: string }) {
  if (icon && /^\p{Emoji}/u.test(icon)) return <span className={className}>{icon}</span>;
  return <LayoutGrid className={className} />;
}

function EditCollectionDialog({ collection, open, onOpenChange, onSaved }: { collection: Collection | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (collection: Collection) => void }) {
  const [values, setValues] = useState({ name: "", icon: "📚", description: "", visibility: "private" as "private" | "personal" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!collection || !open) return;
    setValues({ name: collection.name, icon: collection.icon || "📚", description: collection.description || "", visibility: collection.visibility === "personal" ? "personal" : "private" });
    setErrors({});
  }, [collection, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!collection) return;
    const parsed = collectionFormSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof typeof values, string>> = {};
      parsed.error.issues.forEach((issue) => { const key = issue.path[0] as keyof typeof values | undefined; if (key) next[key] = issue.message; });
      setErrors(next);
      return;
    }
    setIsSubmitting(true);
    const { data, error } = await supabase.from("collections").update({ name: parsed.data.name, icon: parsed.data.icon || null, description: parsed.data.description || null, visibility: parsed.data.visibility }).eq("id", collection.id).eq("user_id", collection.user_id).select("*").single();
    setIsSubmitting(false);
    if (error || !data) return toast.error("Could not update collection", { description: "Please try again." });
    toast.success("Collection updated");
    onSaved(data);
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Edit Collection</DialogTitle></DialogHeader><form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label>Name</Label><Input value={values.name} maxLength={60} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />{errors.name && <p className="text-xs text-destructive">{errors.name}</p>}</div><div className="space-y-2"><Label>Icon</Label><div className="flex flex-wrap gap-2">{emojiOptions.map((emoji) => <button key={emoji} type="button" className={cn("flex h-9 w-9 items-center justify-center rounded-md border text-lg hover:bg-accent", values.icon === emoji && "border-primary bg-primary/10")} onClick={() => setValues((current) => ({ ...current, icon: emoji }))}>{emoji}</button>)}</div><Input value={values.icon} maxLength={4} onChange={(event) => setValues((current) => ({ ...current, icon: event.target.value }))} className="w-24" />{errors.icon && <p className="text-xs text-destructive">{errors.icon}</p>}</div><div className="space-y-2"><Label>Description</Label><Textarea value={values.description} maxLength={200} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} />{errors.description && <p className="text-xs text-destructive">{errors.description}</p>}</div><RadioGroup value={values.visibility} onValueChange={(value) => setValues((current) => ({ ...current, visibility: value as "private" | "personal" }))}><Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="private" /> Private (only me)</Label><Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="personal" /> Personal (visible to my AI agents)</Label></RadioGroup><DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={isSubmitting}>Save</Button></DialogFooter></form></DialogContent></Dialog>;
}

export default function CollectionDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [cursorStack, setCursorStack] = useState<Cursor[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fields = useMemo(() => parseSchema(collection?.field_schema ?? []), [collection?.field_schema]);
  const primaryField = fields.find((field) => field.primary);
  const nonPrimaryFields = fields.filter((field) => !field.primary);
  const visibleFields = nonPrimaryFields.filter((field) => visibleKeys.includes(field.key));

  useEffect(() => {
    if (visibleKeys.length || nonPrimaryFields.length === 0) return;
    setVisibleKeys(nonPrimaryFields.slice(0, 5).map((field) => field.key));
  }, [nonPrimaryFields, visibleKeys.length]);

  useEffect(() => {
    setCursorStack([]);
    setNextCursor(null);
  }, [query, sort, slug]);

  useEffect(() => {
    if (!user || !slug) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const { data: current, error } = await supabase.from("collections").select("*").eq("user_id", user.id).eq("slug", slug).maybeSingle();
      if (cancelled) return;
      if (error || !current) {
        toast.error("Could not load collection", { description: error?.message ?? "Collection not found." });
        setIsLoading(false);
        return;
      }
      setCollection(current);
      let request = supabase.from("collection_items").select("*").eq("user_id", user.id).eq("collection_id", current.id).limit(query.trim() ? 200 : PAGE_SIZE + 1);
      const cursor = cursorStack.at(-1);
      if (sort === "updated") request = request.order("updated_at", { ascending: false }).order("id", { ascending: false });
      if (sort === "created") request = request.order("created_at", { ascending: false }).order("id", { ascending: false });
      if (sort === "alpha") request = request.order("title", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
      if (cursor && sort === "updated" && !query.trim()) request = request.or(`updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`);
      const { data: rows, error: itemsError } = await request;
      if (cancelled) return;
      if (itemsError) toast.error("Could not load items", { description: itemsError.message });
      const searchableFields = parseSchema(current.field_schema).filter((field) => ["text", "longtext"].includes(field.type));
      const needle = query.trim().toLowerCase();
      const filtered = needle ? (rows ?? []).filter((item) => [item.title, ...searchableFields.map((field) => asData(item.data)[field.key])].some((value) => String(value ?? "").toLowerCase().includes(needle))) : rows ?? [];
      const page = filtered.slice(0, PAGE_SIZE);
      setItems(page);
      setNextCursor(!needle && filtered.length > PAGE_SIZE ? { updated_at: page.at(-1)?.updated_at ?? "", id: page.at(-1)?.id ?? "" } : null);
      setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user, slug, query, sort, cursorStack]);

  const duplicateItem = async (item: CollectionItem) => {
    if (!user || !collection) return;
    const { error } = await supabase.from("collection_items").insert({ user_id: user.id, collection_id: collection.id, data: item.data, title: item.title ? `${item.title} copy` : null });
    if (error) return toast.error("Could not duplicate item", { description: error.message });
    toast.success("Item duplicated");
    setCursorStack((current) => [...current]);
  };

  const deleteItem = async (item: CollectionItem) => {
    const { error } = await supabase.from("collection_items").delete().eq("id", item.id).eq("user_id", item.user_id);
    if (error) return toast.error("Could not delete item", { description: error.message });
    setItems((current) => current.filter((row) => row.id !== item.id));
    toast.success("Item deleted");
  };

  const deleteCollection = async () => {
    if (!collection) return;
    await supabase.from("collection_items").delete().eq("collection_id", collection.id).eq("user_id", collection.user_id);
    const { error } = await supabase.from("collections").delete().eq("id", collection.id).eq("user_id", collection.user_id);
    if (error) return toast.error("Could not delete collection", { description: error.message });
    toast.success("Collection deleted");
    navigate("/collections");
  };

  if (isLoading && !collection) return <div className="w-full max-w-6xl space-y-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-12 w-full" /><Skeleton className="h-80 w-full" /></div>;

  return <div className="w-full max-w-7xl space-y-6"><SEOHead title={`${collection?.name ?? "Collection"} — Menerio`} noIndex /><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm text-muted-foreground"><Link to="/collections" className="hover:text-foreground">Collections</Link> / {collection?.name}</p><h1 className="mt-2 text-3xl font-bold font-display"><CollectionIcon icon={collection?.icon} className="mr-2 inline-flex h-8 w-8 align-[-0.15em]" />{collection?.name}</h1>{collection?.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{collection.description}</p>}</div><div className="flex items-center gap-2"><Button onClick={() => setSelectedItem({ id: "new", collection_id: collection?.id ?? "", user_id: user?.id ?? "", data: {}, title: null, created_at: "", updated_at: "", indexable_date_1: null, indexable_date_2: null, indexable_number_1: null, indexable_number_2: null, indexable_text_1: null, search_vector: null } as CollectionItem)}><Plus className="mr-2 h-4 w-4" />New Item</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Collection actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => navigate(`/collections/${slug}/schema`)}>Edit Schema</DropdownMenuItem><DropdownMenuItem onClick={() => setEditOpen(true)}>Edit Collection</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>Delete Collection</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>{items.length === 0 && !query.trim() && !isLoading ? <div className="flex min-h-[50vh] items-center justify-center px-4 text-center"><div className="max-w-lg"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary"><CollectionIcon icon={collection?.icon} className="h-9 w-9" /></div><h2 className="text-2xl font-bold font-display">No items yet</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Add your first item, or describe one to your AI assistant — it will know how to capture it here.</p><div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row"><Button onClick={() => setSelectedItem({ id: "new" } as CollectionItem)}><Plus className="mr-2 h-4 w-4" />New Item</Button><button type="button" className="text-sm text-primary hover:underline">Test in chat</button></div></div></div> : <div className="space-y-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="relative w-full md:max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search items" className="pl-9" /></div><div className="flex items-center gap-2"><Select value={sort} onValueChange={(value) => setSort(value as SortKey)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated">Recently updated</SelectItem><SelectItem value="created">Recently added</SelectItem><SelectItem value="alpha">Alphabetical</SelectItem><SelectItem value="custom" disabled>Custom</SelectItem></SelectContent></Select>{nonPrimaryFields.length > 5 && <Popover><PopoverTrigger asChild><Button variant="outline">Columns</Button></PopoverTrigger><PopoverContent align="end" className="w-64"><div className="space-y-3">{nonPrimaryFields.map((field) => <Label key={field.key} className="flex items-center gap-2 text-sm"><Checkbox checked={visibleKeys.includes(field.key)} onCheckedChange={(checked) => setVisibleKeys((current) => checked ? [...current, field.key] : current.filter((key) => key !== field.key))} />{field.label}</Label>)}</div></PopoverContent></Popover>}</div></div><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Title</TableHead>{visibleFields.map((field) => <TableHead key={field.key} className={cn(["number", "currency"].includes(field.type) && "text-right")}>{field.label}</TableHead>)}<TableHead>Updated</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{isLoading ? Array.from({ length: 5 }).map((_, index) => <TableRow key={index}>{Array.from({ length: visibleFields.length + 3 }).map((__, cell) => <TableCell key={cell}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>) : items.length === 0 ? <TableRow><TableCell colSpan={visibleFields.length + 3} className="py-12 text-center text-muted-foreground">No matching items.</TableCell></TableRow> : items.map((item) => { const data = asData(item.data); return <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelectedItem(item)}><TableCell className="font-medium">{item.title || (primaryField ? truncate(data[primaryField.key]) : "Untitled") || "Untitled"}</TableCell>{visibleFields.map((field) => <TableCell key={field.key} className={cn(["number", "currency"].includes(field.type) && "text-right")}><FieldValue field={field} value={data[field.key]} /></TableCell>)}<TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}</TableCell><TableCell onClick={(event) => event.stopPropagation()}><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setSelectedItem(item)}>Edit</DropdownMenuItem><DropdownMenuItem onClick={() => duplicateItem(item)}>Duplicate</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => deleteItem(item)}>Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>; })}</TableBody></Table></div><div className="flex items-center justify-end gap-2"><Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={() => setCursorStack((current) => current.slice(0, -1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => nextCursor && setCursorStack((current) => [...current, nextCursor])}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}<Sheet open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}><SheetContent className="sm:max-w-xl"><SheetHeader><SheetTitle>{selectedItem?.id === "new" ? "New Item" : selectedItem?.title || "Edit Item"}</SheetTitle><SheetDescription>The item form will be added in the next step.</SheetDescription></SheetHeader></SheetContent></Sheet><EditCollectionDialog collection={collection} open={editOpen} onOpenChange={setEditOpen} onSaved={setCollection} /><AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete collection?</AlertDialogTitle><AlertDialogDescription>This permanently deletes this collection and all items inside it. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deleteCollection} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}