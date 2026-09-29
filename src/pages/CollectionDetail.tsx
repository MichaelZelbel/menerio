import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Filter,
  LayoutGrid,
  Link as LinkIcon,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Settings2,
  Trash2,
  User,
  Sparkles,
  X,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { SmartDatePicker } from "@/components/ui/smart-date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { escapeLike, fetchAllPages, ilikeContains } from "@/lib/postgrest";
import { dbErrorMessage } from "@/lib/function-error";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { linkifyText } from "@/lib/linkify";
import { safeExternalUrl } from "@/lib/safe-url";
import { nextDuplicateTitle } from "@/lib/duplicate-entity";
import type { Database, Json } from "@/integrations/supabase/types";
import { CollectionChatPanel } from "@/components/collections/CollectionChatPanel";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { CollectionItemsTree as CollectionItemsFolderTree } from "@/components/collections/CollectionItemsTree";
import type {
  FolderLite,
  ItemLite,
} from "@/components/collections/collectionItemsTreeBuild";
import { LoadErrorState } from "@/components/collections/LoadErrorState";
import {
  duplicateItemData,
  mergeItemData,
} from "@/components/collections/collectionItemData";

type Collection = Database["public"]["Tables"]["collections"]["Row"];
type CollectionItem = Database["public"]["Tables"]["collection_items"]["Row"];
type FieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "currency"
  | "url"
  | "email"
  | "phone"
  | "note"
  | "person"
  | "collection"
  | "link_note"
  | "link_person"
  | "link_collection_item";
type SchemaField = {
  key: string;
  label: string;
  type: FieldType;
  primary?: boolean;
  options?: string[];
  target_collection_slug?: string | null;
};
type ItemData = Record<string, unknown>;
type LinkValue = {
  type: "note" | "person" | "collection_item";
  id: string;
  label: string;
  collection_id?: string;
};
type FormValue = string | number | boolean | string[] | LinkValue | null;
type FormValues = Record<string, FormValue>;
type FormErrors = Record<string, string>;
type Cursor = { updated_at: string; id: string };
type SortKey = "updated" | "created" | "alpha";
type LinkValidity = {
  notes: Set<string>;
  people: Set<string>;
  items: Set<string>;
};

const emptyLinkValidity = (): LinkValidity => ({
  notes: new Set(),
  people: new Set(),
  items: new Set(),
});

const PAGE_SIZE = 50;
// The whole matching set is fetched (in chunks) and then sorted, filtered and
// paginated in the browser, so a sort or filter always sees every item, not
// just the first page. FETCH_CHUNK is one PostgREST request; MAX_CLIENT_ROWS
// caps how many rows are ever pulled so a runaway collection cannot exhaust
// memory — past that the UI says so instead of silently hiding the rest.
const FETCH_CHUNK = 1000;
const MAX_CLIENT_ROWS = 5000;
// Every item column except search_vector, which nothing here reads and which
// is the largest thing in each row.
const ITEM_COLUMNS =
  "id, collection_id, user_id, data, title, folder_id, is_favorite, last_viewed_at, created_at, updated_at, ai_visibility, contact_id, entity_id, indexable_date_1, indexable_date_2, indexable_number_1, indexable_number_2, indexable_text_1";
const TITLE_KEY = "__title__";
const UPDATED_KEY = "__updated__";

type ColumnSort = { key: string; dir: "asc" | "desc" } | null;
type ColumnFilter =
  | { type: "text"; value: string }
  | { type: "number"; min: number | null; max: number | null }
  | { type: "date"; from: string | null; to: string | null }
  | { type: "boolean"; value: true | false | null }
  | { type: "set"; values: string[] };
type ColumnFilters = Record<string, ColumnFilter>;

function isFilterActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  if (filter.type === "text") return filter.value.trim() !== "";
  if (filter.type === "number")
    return filter.min !== null || filter.max !== null;
  if (filter.type === "date") return !!filter.from || !!filter.to;
  if (filter.type === "boolean") return filter.value !== null;
  if (filter.type === "set") return filter.values.length > 0;
  return false;
}

function countActiveFilters(filters: ColumnFilters): number {
  return Object.values(filters).filter(isFilterActive).length;
}

function getCellValue(
  field: SchemaField | { key: string; type: "title" | "updated" | "created" },
  item: CollectionItem,
): unknown {
  if (field.type === "title") return item.title ?? "";
  if (field.type === "updated") return item.updated_at;
  if (field.type === "created") return item.created_at;
  return asData(item.data)[field.key];
}

function numericValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateMs(value: unknown): number | null {
  const d = parseDate(value);
  return d ? d.getTime() : null;
}

function stringifyForCompare(field: SchemaField | { type: string }, value: unknown): string {
  if (value == null) return "";
  if (isLinkValue(value)) return value.label.toLowerCase();
  if (Array.isArray(value)) return value.map(String).join(", ").toLowerCase();
  return String(value).toLowerCase();
}

function isEmptyCell(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function compareValues(
  a: unknown,
  b: unknown,
  fieldType: string,
): number {
  const aEmpty = isEmptyCell(a);
  const bEmpty = isEmptyCell(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empties last
  if (bEmpty) return -1;
  if (["number", "currency"].includes(fieldType)) {
    const an = numericValue(a) ?? 0;
    const bn = numericValue(b) ?? 0;
    return an - bn;
  }
  if (["date", "datetime", "updated", "created"].includes(fieldType)) {
    const am = dateMs(a) ?? 0;
    const bm = dateMs(b) ?? 0;
    return am - bm;
  }
  if (fieldType === "boolean") {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return stringifyForCompare({ type: fieldType }, a).localeCompare(
    stringifyForCompare({ type: fieldType }, b),
  );
}

function matchesFilter(
  fieldType: string,
  value: unknown,
  filter: ColumnFilter,
): boolean {
  if (!isFilterActive(filter)) return true;
  if (filter.type === "text") {
    const needle = filter.value.trim().toLowerCase();
    return stringifyForCompare({ type: fieldType }, value).includes(needle);
  }
  if (filter.type === "number") {
    const n = numericValue(value);
    if (n === null) return false;
    if (filter.min !== null && n < filter.min) return false;
    if (filter.max !== null && n > filter.max) return false;
    return true;
  }
  if (filter.type === "date") {
    const ms = dateMs(value);
    if (ms === null) return false;
    if (filter.from) {
      const fromMs = dateMs(filter.from);
      if (fromMs !== null && ms < fromMs) return false;
    }
    if (filter.to) {
      const toMs = dateMs(filter.to);
      // Include the entire "to" day
      if (toMs !== null && ms > toMs + 24 * 60 * 60 * 1000 - 1) return false;
    }
    return true;
  }
  if (filter.type === "boolean") {
    return Boolean(value) === filter.value;
  }
  if (filter.type === "set") {
    if (Array.isArray(value))
      return value.some((v) => filter.values.includes(String(v)));
    return filter.values.includes(String(value ?? ""));
  }
  return true;
}

function defaultFilterFor(fieldType: string): ColumnFilter {
  if (["number", "currency"].includes(fieldType))
    return { type: "number", min: null, max: null };
  if (["date", "datetime", "updated", "created"].includes(fieldType))
    return { type: "date", from: null, to: null };
  if (fieldType === "boolean") return { type: "boolean", value: null };
  if (["select", "multiselect"].includes(fieldType))
    return { type: "set", values: [] };
  return { type: "text", value: "" };
}

type StoredView = {
  sort?: SortKey;
  columnSort?: ColumnSort;
  columnFilters?: ColumnFilters;
  visibleKeys?: string[];
};

/** The table view (sort, filters, columns) last used for this collection. */
function readStoredView(slug: string | undefined): StoredView {
  if (!slug) return {};
  try {
    const raw = localStorage.getItem(`collection:${slug}:view`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredView;
    return {
      sort: parsed.sort || undefined,
      columnSort: parsed.columnSort !== undefined ? parsed.columnSort : undefined,
      columnFilters: parsed.columnFilters || undefined,
      visibleKeys: Array.isArray(parsed.visibleKeys) ? parsed.visibleKeys : undefined,
    };
  } catch {
    return {};
  }
}


const emojiOptions = [
  "📚",
  "🏠",
  "💼",
  "🎯",
  "🍳",
  "✏️",
  "🎨",
  "💡",
  "🔧",
  "🌱",
];
const collectionFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer"),
  icon: z
    .string()
    .trim()
    .refine(
      (value) =>
        !value ||
        (/^\p{Emoji}/u.test(value) &&
          Array.from(value.replace(/\uFE0F/g, "")).length === 1),
      "Use a single emoji",
    ),
  description: z
    .string()
    .trim()
    .max(200, "Description must be 200 characters or fewer")
    .optional(),
  visibility: z.enum(["private", "personal"]),
});

function parseSchema(value: Json): SchemaField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, Json | undefined>;
    if (
      typeof item.key !== "string" ||
      typeof item.label !== "string" ||
      typeof item.type !== "string"
    )
      return [];
    return [
      {
        key: item.key,
        label: item.label,
        type: item.type as FieldType,
        primary: item.primary === true,
        options: Array.isArray(item.options)
          ? item.options.filter(
              (option): option is string => typeof option === "string",
            )
          : undefined,
        target_collection_slug:
          typeof item.target_collection_slug === "string"
            ? item.target_collection_slug
            : typeof item.collection_id === "string"
              ? item.collection_id
              : null,
      },
    ];
  });
}

function asData(value: Json): ItemData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ItemData)
    : {};
}

function truncate(value: unknown, length = 60) {
  const text = value == null ? "" : String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function toInputString(value: unknown) {
  return value == null ? "" : String(value);
}

function isEmptyValue(value: FormValue) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isLinkValue(value: unknown): value is LinkValue {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as LinkValue).type === "string" &&
    typeof (value as LinkValue).id === "string" &&
    typeof (value as LinkValue).label === "string",
  );
}

function parseDate(value: unknown) {
  if (!value) return null;
  const date =
    typeof value === "string" ? parseISO(value) : new Date(String(value));
  return isValid(date) ? date : null;
}

function toDateInput(value: unknown) {
  const date = parseDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}

function toTimeInput(value: unknown) {
  const date = parseDate(value);
  return date ? format(date, "HH:mm") : "";
}

function renderDate(value: unknown) {
  const date = parseDate(value);
  if (!date) return "—";
  const age = Math.abs(Date.now() - date.getTime());
  return age <= 7 * 24 * 60 * 60 * 1000
    ? formatDistanceToNow(date, { addSuffix: true })
    : format(date, "MMM d, yyyy");
}

function optionClass(value: string) {
  const variants = [
    "border-primary/30 bg-primary/10 text-primary",
    "border-accent/40 bg-accent text-accent-foreground",
    "border-secondary bg-secondary text-secondary-foreground",
    "border-muted bg-muted text-muted-foreground",
  ];
  const index =
    Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    variants.length;
  return variants[index];
}

function LinkChip({
  value,
  collectionLabel,
  onOpen,
}: {
  value: unknown;
  collectionLabel?: string;
  onOpen: (link: LinkValue) => void;
}) {
  if (!isLinkValue(value))
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        [deleted]
      </Badge>
    );
  const deleted = value.label === "[deleted]";
  const Icon =
    value.type === "note"
      ? FileText
      : value.type === "person"
        ? User
        : LayoutGrid;
  const label =
    value.type === "note"
      ? "Note"
      : value.type === "person"
        ? "Person"
        : collectionLabel || "Collection item";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={deleted}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(value);
          }}
          className={cn(
            "inline-flex max-w-56 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
            deleted
              ? "cursor-default border-muted bg-muted text-muted-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-accent",
          )}
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {deleted ? "[deleted]" : value.label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{deleted ? "Deleted" : label}</TooltipContent>
    </Tooltip>
  );
}

function linkValueWithValidity(
  value: unknown,
  validity?: LinkValidity,
): LinkValue | null {
  if (!isLinkValue(value)) return null;
  if (value.type === "note" && validity && !validity.notes.has(value.id))
    return { ...value, label: "[deleted]" };
  if (value.type === "person" && validity && !validity.people.has(value.id))
    return { ...value, label: "[deleted]" };
  if (
    value.type === "collection_item" &&
    validity &&
    !validity.items.has(value.id)
  )
    return { ...value, label: "[deleted]" };
  return value;
}

function FieldValue({
  field,
  value,
  collections,
  onOpenLink,
  linkValidity,
}: {
  field: SchemaField;
  value: unknown;
  collections: Collection[];
  onOpenLink: (link: LinkValue) => void;
  linkValidity?: LinkValidity;
}) {
  if (value == null || value === "")
    return <span className="text-muted-foreground">—</span>;
  if (
    ["link_note", "link_person", "link_collection_item"].includes(field.type)
  ) {
    const checked = linkValueWithValidity(value, linkValidity);
    const collectionLabel = checked?.collection_id
      ? collections.find(
          (collection) => collection.id === checked.collection_id,
        )?.name
      : collections.find(
          (collection) => collection.slug === field.target_collection_slug,
        )?.name;
    return (
      <LinkChip
        value={checked}
        collectionLabel={collectionLabel}
        onOpen={onOpenLink}
      />
    );
  }
  if (field.type === "number")
    return (
      <span className="block text-right tabular-nums">
        {Number(value).toLocaleString()}
      </span>
    );
  if (field.type === "currency")
    return (
      <span className="block text-right tabular-nums">
        {Number(value).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
        })}
      </span>
    );
  if (field.type === "date" || field.type === "datetime")
    return <span>{renderDate(value)}</span>;
  if (field.type === "boolean")
    return value ? <Check className="h-4 w-4 text-primary" /> : <span />;
  if (field.type === "select")
    return (
      <Badge
        variant="outline"
        className={cn("max-w-40 truncate", optionClass(String(value)))}
      >
        {String(value)}
      </Badge>
    );
  if (field.type === "multiselect") {
    const values = Array.isArray(value) ? value : [value];
    return (
      <div className="flex max-w-64 flex-wrap gap-1">
        {values.map((item) => (
          <Badge
            key={String(item)}
            variant="outline"
            className={cn("text-[10px]", optionClass(String(item)))}
          >
            {String(item)}
          </Badge>
        ))}
      </div>
    );
  }
  if (field.type === "url") {
    // Collection items are also written by the AI and the MCP tools; a
    // javascript: value rendered as an href runs in this origin on click.
    const href = safeExternalUrl(String(value));
    if (!href) return <span className="truncate">{truncate(value)}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-60 items-center gap-1 truncate text-primary hover:underline"
      >
        {truncate(value)}
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }
  if (field.type === "email")
    return (
      <a
        href={`mailto:${String(value)}`}
        className="max-w-60 truncate text-primary hover:underline"
      >
        {truncate(value)}
      </a>
    );
  if (field.type === "phone")
    return (
      <a
        href={`tel:${String(value)}`}
        className="max-w-60 truncate text-primary hover:underline"
      >
        {truncate(value)}
      </a>
    );
  if (
    [
      "note",
      "person",
      "collection",
      "link_note",
      "link_person",
      "link_collection_item",
    ].includes(field.type)
  )
    return (
      <Badge variant="secondary" className="max-w-48 truncate">
        {String(value)}
      </Badge>
    );
  if (field.type === "longtext") {
    const text = String(value);
    return (
      <span className="block whitespace-pre-wrap break-words" title={text}>
        {linkifyText(text)}
      </span>
    );
  }
  const text = String(value);
  return (
    <span className="block max-w-80 truncate" title={text}>
      {linkifyText(text)}
    </span>
  );
}

function CollectionIcon({
  icon,
  className = "h-5 w-5",
}: {
  icon?: string | null;
  className?: string;
}) {
  if (icon && /^\p{Emoji}/u.test(icon))
    return <span className={className}>{icon}</span>;
  return <LayoutGrid className={className} />;
}

function itemDisplayTitle(item: CollectionItem, primaryField?: SchemaField) {
  const data = asData(item.data);
  return (
    item.title ||
    (primaryField ? truncate(data[primaryField.key]) : "Untitled") ||
    "Untitled"
  );
}

function CollectionItemsTree({
  collection,
  folders,
  treeItems,
  selectedItemId,
  query,
  onQueryChange,
  onSelectItem,
  onNewItem,
  isLoading,
  onToggleFavorite,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReparentFolder,
  onMoveItemToFolder,
  onDuplicateItem,
  onDeleteItem,
}: {
  collection: Collection | null;
  folders: FolderLite[];
  treeItems: ItemLite[];
  selectedItemId?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectItem: (item: { id: string }) => void;
  onNewItem: (folderId?: string | null) => void;
  isLoading: boolean;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onRenameFolder: (folderId: string, currentName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onReparentFolder: (folderId: string, parentFolderId: string | null) => void;
  onMoveItemToFolder: (itemId: string, folderId: string | null) => void;
  onDuplicateItem: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b bg-background lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <CollectionIcon icon={collection?.icon} className="h-4 w-4" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold font-display">
            {collection?.name ?? "Collection"}
          </div>
          {/* The whole collection, not the table's current page (at most 50). */}
          <div className="text-[10px] text-muted-foreground">
            {treeItems.length} item{treeItems.length === 1 ? "" : "s"}
          </div>
        </div>
        <Button aria-label="New item" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onNewItem()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search items"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search items"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        <CollectionItemsFolderTree
          items={treeItems}
          folders={folders}
          selectedItemId={selectedItemId ?? null}
          searchQuery={query}
          onSelectItem={(id) => onSelectItem({ id })}
          onToggleFavorite={onToggleFavorite}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onReparentFolder={onReparentFolder}
          onMoveItemToFolder={onMoveItemToFolder}
          onCreateItem={(folderId) => onNewItem(folderId)}
          onDuplicateItem={onDuplicateItem}
          onDeleteItem={onDeleteItem}
        />
      )}
    </aside>
  );
}


function initialFormValues(
  fields: SchemaField[],
  item: CollectionItem | null,
): FormValues {
  const data = asData(item?.data ?? {});
  return fields.reduce<FormValues>((values, field) => {
    const value = data[field.key];
    if (field.type === "boolean") values[field.key] = Boolean(value);
    else if (field.type === "multiselect")
      values[field.key] = Array.isArray(value) ? value.map(String) : [];
    else if (
      ["link_note", "link_person", "link_collection_item"].includes(field.type)
    )
      values[field.key] = isLinkValue(value) ? value : null;
    else values[field.key] = value == null ? "" : String(value);
    return values;
  }, {});
}

function validateItemValues(fields: SchemaField[], values: FormValues) {
  const errors: FormErrors = {};
  const data: Record<string, Json> = {};

  fields.forEach((field) => {
    const value = values[field.key];
    if (field.primary && isEmptyValue(value))
      errors[field.key] = "Primary field cannot be empty.";
    if (isEmptyValue(value)) return;

    if (field.type === "number" || field.type === "currency") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        errors[field.key] = "Enter a valid number.";
        return;
      }
      data[field.key] = numeric;
      return;
    }

    if (field.type === "url") {
      const parsed = z
        .string()
        .trim()
        .url("Enter a valid URL.")
        .safeParse(value);
      if (!parsed.success) {
        errors[field.key] =
          parsed.error.issues[0]?.message ?? "Enter a valid URL.";
        return;
      }
      data[field.key] = parsed.data;
      return;
    }

    if (field.type === "email") {
      const parsed = z
        .string()
        .trim()
        .email("Enter a valid email address.")
        .max(255)
        .safeParse(value);
      if (!parsed.success) {
        errors[field.key] =
          parsed.error.issues[0]?.message ?? "Enter a valid email address.";
        return;
      }
      data[field.key] = parsed.data;
      return;
    }

    if (
      ["link_note", "link_person", "link_collection_item"].includes(field.type)
    ) {
      if (!isLinkValue(value)) return;
      data[field.key] = value as unknown as Json;
    } else if (field.type === "boolean") data[field.key] = Boolean(value);
    else if (field.type === "multiselect")
      data[field.key] = Array.isArray(value) ? value : [];
    else data[field.key] = String(value).trim();
  });

  return { errors, data };
}

function LinkPicker({
  field,
  value,
  onChange,
  collections,
  currentCollection,
}: {
  field: SchemaField;
  value: LinkValue | null;
  onChange: (value: FormValue) => void;
  collections: Collection[];
  currentCollection: Collection | null;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; label: string; collection_id?: string }>
  >([]);
  const [targetCollectionId, setTargetCollectionId] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const targetCollection =
    collections.find(
      (collection) => collection.slug === field.target_collection_slug,
    ) ??
    collections.find((collection) => collection.id === targetCollectionId) ??
    currentCollection;

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const term = search.trim();
      if (field.type === "link_note") {
        const request = supabase
          .from("notes")
          .select("id, title")
          .eq("user_id", userId)
          .eq("is_trashed", false)
          .order("updated_at", { ascending: false })
          .limit(10);
        const { data } = term
          ? await request.or(
              [ilikeContains("title", term), ilikeContains("content", term)].join(","),
            )
          : await request;
        if (!cancelled)
          setResults(
            (data ?? []).map((note) => ({
              id: note.id,
              label: note.title || "Untitled",
            })),
          );
      } else if (field.type === "link_person") {
        const request = supabase
          .from("contacts")
          .select("id, name")
          .eq("user_id", userId)
          .is("merged_into", null)
          .order("name")
          .limit(10);
        const { data } = term
          ? await request.ilike("name", `%${escapeLike(term)}%`)
          : await request;
        if (!cancelled)
          setResults(
            (data ?? []).map((person) => ({
              id: person.id,
              label: person.name,
            })),
          );
      } else if (
        field.type === "link_collection_item" &&
        targetCollection?.id
      ) {
        const request = supabase
          .from("collection_items")
          .select("id, title, collection_id")
          .eq("user_id", userId)
          .eq("collection_id", targetCollection.id)
          .order("updated_at", { ascending: false })
          .limit(10);
        // Quoted and escaped: a comma or a parenthesis in the search text
        // used to break (or rewrite) the .or() filter.
        const { data } = term
          ? await request.or(
              [
                ilikeContains("title", term),
                ilikeContains("indexable_text_1", term),
              ].join(","),
            )
          : await request;
        if (!cancelled)
          setResults(
            (data ?? []).map((item) => ({
              id: item.id,
              label: item.title || "Untitled",
              collection_id: item.collection_id,
            })),
          );
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [field.type, search, targetCollection?.id, userId]);

  const createPerson = async () => {
    if (!user || !newPersonName.trim()) return;
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        user_id: user.id,
        name: newPersonName.trim(),
        aliases: [],
        app_mappings: {},
      })
      .select("id, name")
      .single();
    if (error || !data)
      return toast.error("Could not create person", {
        description: dbErrorMessage(error, "Please try again."),
      });
    onChange({ type: "person", id: data.id, label: data.name });
    setNewPersonName("");
  };

  const buttonLabel =
    value?.label ||
    (field.type === "link_note"
      ? "+ Link a note"
      : field.type === "link_person"
        ? "+ Link a person"
        : `+ Link to ${targetCollection?.name ?? "collection item"}`);
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "min-w-0 flex-1 justify-start",
              !value && "text-muted-foreground",
            )}
          >
            {field.type === "link_note" ? (
              <FileText className="mr-2 h-4 w-4" />
            ) : field.type === "link_person" ? (
              <User className="mr-2 h-4 w-4" />
            ) : (
              <LayoutGrid className="mr-2 h-4 w-4" />
            )}
            <span className="truncate">{buttonLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
          />
          {field.type === "link_collection_item" &&
            !field.target_collection_slug && (
              <Select
                value={targetCollectionId || currentCollection?.id || ""}
                onValueChange={setTargetCollectionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose collection" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((collection) => (
                    <SelectItem key={collection.id} value={collection.id}>
                      {collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          <div className="max-h-64 overflow-y-auto space-y-1">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() =>
                  onChange(
                    field.type === "link_note"
                      ? { type: "note", id: result.id, label: result.label }
                      : field.type === "link_person"
                        ? { type: "person", id: result.id, label: result.label }
                        : {
                            type: "collection_item",
                            id: result.id,
                            label: result.label,
                            collection_id:
                              result.collection_id ?? targetCollection?.id,
                          },
                  )
                }
              >
                <span className="truncate">{result.label}</span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No results
              </p>
            )}
          </div>
          {field.type === "link_person" && (
            <div className="border-t pt-3">
              <div className="flex gap-2">
                <Input
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  placeholder="New person name"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={createPerson}
                >
                  Create
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange(null)}
          aria-label="Clear link"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
  collections,
  currentCollection,
}: {
  field: SchemaField;
  value: FormValue;
  error?: string;
  onChange: (value: FormValue) => void;
  collections: Collection[];
  currentCollection: Collection | null;
}) {
  const selectedDate = parseDate(value);
  const label = (
    <div className="mb-2 flex items-center gap-2">
      <Label>{field.label}</Label>
      {field.primary && (
        <Badge variant="secondary" className="text-[10px]">
          primary
        </Badge>
      )}
    </div>
  );
  const inputClass = error
    ? "border-destructive focus-visible:ring-destructive"
    : undefined;

  if (field.type === "boolean") {
    return (
      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Label>{field.label}</Label>
            {field.primary && (
              <Badge variant="secondary" className="text-[10px]">
                primary
              </Badge>
            )}
          </div>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (
    ["link_note", "link_person", "link_collection_item"].includes(field.type)
  ) {
    return (
      <div>
        {label}
        <LinkPicker
          field={field}
          value={isLinkValue(value) ? value : null}
          onChange={onChange}
          collections={collections}
          currentCollection={currentCollection}
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (["note", "person", "collection"].includes(field.type))
    return (
      <div>
        {label}
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Link picker coming soon
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );

  return (
    <div>
      {label}
      {field.type === "longtext" ? (
        <Textarea
          value={toInputString(value)}
          rows={3}
          className={cn("max-h-72 min-h-24 resize-none", inputClass)}
          onChange={(event) => {
            onChange(event.target.value);
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 288)}px`;
          }}
        />
      ) : field.type === "number" ? (
        <Input
          type="number"
          value={toInputString(value)}
          className={inputClass}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === "currency" ? (
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="number"
            step="0.01"
            value={toInputString(value)}
            className={cn("pl-9", inputClass)}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : field.type === "date" ? (
        <SmartDatePicker
          value={selectedDate ?? null}
          onChange={(date) => onChange(date ? format(date, "yyyy-MM-dd") : "")}
          className={inputClass}
        />
      ) : field.type === "datetime" ? (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <SmartDatePicker
            value={selectedDate ?? null}
            onChange={(date) => {
              const currentTime = toTimeInput(value) || "09:00";
              onChange(
                date ? `${format(date, "yyyy-MM-dd")}T${currentTime}` : "",
              );
            }}
            className={inputClass}
          />
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="time"
              value={toTimeInput(value)}
              className="pl-9"
              onChange={(event) => {
                const datePart =
                  toDateInput(value) || format(new Date(), "yyyy-MM-dd");
                onChange(`${datePart}T${event.target.value}`);
              }}
            />
          </div>
        </div>
      ) : field.type === "select" ? (
        <Select value={toInputString(value)} onValueChange={onChange}>
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder="Select option" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "multiselect" ? (
        <div className="space-y-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
              >
                Choose options
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="space-y-3">
                {(field.options ?? []).map((option) => {
                  const selected =
                    Array.isArray(value) && value.includes(option);
                  return (
                    <Label
                      key={option}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          onChange(
                            checked
                              ? [...(Array.isArray(value) ? value : []), option]
                              : (Array.isArray(value) ? value : []).filter(
                                  (item) => item !== option,
                                ),
                          )
                        }
                      />
                      {option}
                    </Label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          {Array.isArray(value) && value.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {value.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : field.type === "url" ? (
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="url"
              value={toInputString(value)}
              className={cn("pl-9", inputClass)}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
          {value && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // z.string().url() accepts javascript: URLs.
                const safe = safeExternalUrl(value);
                if (safe) window.open(safe, "_blank", "noopener,noreferrer");
                else toast.error("Enter a valid URL first");
              }}
            >
              Test link
            </Button>
          )}
        </div>
      ) : field.type === "email" ? (
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="email"
            value={toInputString(value)}
            className={cn("pl-9", inputClass)}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : field.type === "phone" ? (
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="tel"
            value={toInputString(value)}
            className="pl-9"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : (
        <Input
          value={toInputString(value)}
          className={inputClass}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

type ItemNote = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
};

function ItemNotesPanel({
  itemId,
  itemTitle,
  collectionId,
  collectionName,
  onClose,
}: {
  itemId: string;
  itemTitle: string;
  collectionId: string;
  collectionName: string;
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ItemNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirm, confirmDialog] = useConfirmDialog();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<ItemNote[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const userId = user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("notes")
      .select("id, title, content, updated_at")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .filter("metadata->>collection_item_id", "eq", itemId)
      .order("updated_at", { ascending: false });
    setIsLoading(false);
    if (error) {
      toast.error("Could not load notes", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    setNotes((data ?? []) as ItemNote[]);
  }, [itemId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Search existing notes when popover open
  useEffect(() => {
    if (!linkOpen || !userId) return;
    let cancelled = false;
    const run = async () => {
      setIsSearching(true);
      const linkedIds = notes.map((n) => n.id);
      let query = supabase
        .from("notes")
        .select("id, title, content, updated_at")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (linkQuery.trim()) {
        query = query.ilike("title", `%${escapeLike(linkQuery.trim())}%`);
      }
      if (linkedIds.length > 0) {
        query = query.not("id", "in", `(${linkedIds.join(",")})`);
      }
      const { data, error } = await query;
      if (cancelled) return;
      setIsSearching(false);
      if (error) {
        toast.error("Search failed", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      setLinkResults((data ?? []) as ItemNote[]);
    };
    const t = setTimeout(run, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [linkOpen, linkQuery, notes, userId]);

  const createNote = async () => {
    if (!user) return;
    setIsCreating(true);
    const { data, error } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        title: itemTitle,
        content: "",
        metadata: {
          collection_item_id: itemId,
          collection_id: collectionId,
          collection_name: collectionName,
        },
      })
      .select("id")
      .single();
    setIsCreating(false);
    if (error || !data) {
      toast.error("Could not create note", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    onClose?.();
    navigate(`/dashboard/notes/${data.id}`);
  };

  const linkExisting = async (note: ItemNote) => {
    if (!user) return;
    // Fetch existing metadata to merge
    const { data: existing, error: fetchErr } = await supabase
      .from("notes")
      .select("metadata")
      .eq("id", note.id)
      .eq("user_id", user.id)
      .single();
    if (fetchErr) {
      toast.error("Could not link note", {
        description: dbErrorMessage(fetchErr, "Please try again."),
      });
      return;
    }
    const merged = {
      ...((existing?.metadata as Record<string, unknown>) ?? {}),
      collection_item_id: itemId,
      collection_id: collectionId,
      collection_name: collectionName,
    } as Json;
    const { error } = await supabase
      .from("notes")
      .update({ metadata: merged })
      .eq("id", note.id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Could not link note", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    setLinkOpen(false);
    setLinkQuery("");
    toast.success("Note linked");
    load();
  };

  const unlinkNote = async (note: ItemNote) => {
    if (!user) return;
    if (!(await confirm({ title: "Unlink this note from the item?", description: "The note itself stays in your Notes app.", confirmLabel: "Unlink" }))) return;
    // Preserve other metadata, only strip our keys. A failed read must stop
    // here: writing on without it would replace the note's metadata with {}.
    const { data: existing, error: readError } = await supabase
      .from("notes")
      .select("metadata")
      .eq("id", note.id)
      .eq("user_id", user.id)
      .single();
    if (readError || !existing) {
      toast.error("Could not unlink note", {
        description: dbErrorMessage(readError, "Please try again."),
      });
      return;
    }
    const meta = { ...((existing?.metadata as Record<string, unknown>) ?? {}) };
    delete meta.collection_item_id;
    delete meta.collection_id;
    delete meta.collection_name;
    const { error } = await supabase
      .from("notes")
      .update({ metadata: meta as Json })
      .eq("id", note.id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Could not unlink note", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    setNotes((current) => current.filter((n) => n.id !== note.id));
  };

  const deleteNote = async (note: ItemNote) => {
    if (!user) return;
    if (!(await confirm({ title: `Move "${note.title || "Untitled"}" to trash?`, description: "You can restore it from the trash in Notes.", confirmLabel: "Move to trash", destructive: true }))) return;
    const { error } = await supabase
      .from("notes")
      .update({ is_trashed: true, trashed_at: new Date().toISOString() })
      .eq("id", note.id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Could not delete note", {
        description: dbErrorMessage(error, "Please try again."),
      });
      return;
    }
    setNotes((current) => current.filter((n) => n.id !== note.id));
  };

  const openNote = (note: ItemNote) => {
    onClose?.();
    navigate(`/dashboard/notes/${note.id}`);
  };

  return (
    <section className="mt-8 border-t pt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Notes</h3>
          <p className="text-xs text-muted-foreground">
            Link notes from your vault to this item. Editing happens in the Notes app.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={linkOpen} onOpenChange={setLinkOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <LinkIcon className="mr-1 h-3.5 w-3.5" />
                Link existing
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b p-2">
                <Input aria-label="Search notes by title"
                  autoFocus
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  placeholder="Search notes by title…"
                  className="h-8"
                />
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {isSearching ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Searching…
                  </div>
                ) : linkResults.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No notes found.
                  </div>
                ) : (
                  linkResults.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => linkExisting(note)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <div className="truncate font-medium">
                        {note.title || "Untitled"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatDistanceToNow(parseISO(note.updated_at), { addSuffix: true })}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            size="sm"
            onClick={createNote}
            disabled={isCreating}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            New note
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : notes.length === 0 ? (
        <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
          No notes linked yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border bg-card">
              <div className="flex items-start justify-between gap-2 p-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openNote(note)}
                >
                  <div className="truncate text-sm font-medium">
                    {note.title || "Untitled"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {note.content
                      ? note.content.replace(/[#*_`>-]+/g, "").slice(0, 80)
                      : "Empty note"}{" "}
                    · {formatDistanceToNow(parseISO(note.updated_at), { addSuffix: true })}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label="Note actions" variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openNote(note)}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in Notes
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => unlinkNote(note)}>
                      Unlink from item
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => deleteNote(note)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete note
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}

function ItemSheet({
  collection,
  fields,
  item,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
  onDuplicate,
  collections,
  inline = false,
  folderId = null,
}: {
  collection: Collection | null;
  fields: SchemaField[];
  item: CollectionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: CollectionItem) => void;
  onDeleted: (id: string) => void;
  onDuplicate?: (item: CollectionItem) => void;
  collections: Collection[];
  /** Render as a routed inline detail view (full-width) instead of a right-side Sheet. */
  inline?: boolean;
  /** The folder a new item is created in ("New item here" on a folder). */
  folderId?: string | null;
}) {
  const { user } = useAuth();
  const userId = user?.id;
  const [values, setValues] = useState<FormValues>({});
  const [initialValues, setInitialValues] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Set while a save is in flight, so Enter or Ctrl+Enter pressed twice
  // cannot create the item twice.
  const savingRef = useRef(false);
  // The item, and the stored values of it, that the form was last filled from.
  const filledFrom = useRef<{ key: string; signature: string } | null>(null);
  const isCreate = item?.id === "new";
  const isDirty = JSON.stringify(values) !== initialValues;
  const itemKey = isCreate ? "new" : (item?.id ?? "");
  // What the stored item would put in the form. The page replaces the item
  // and schema objects on every reload, so this is compared by content.
  const storedSignature = useMemo(
    () => JSON.stringify(initialFormValues(fields, isCreate ? null : item)),
    [fields, isCreate, item],
  );

  // Fill the form when another item opens. When the same item reloads (the
  // AI chat changed the collection, a token refresh), take the stored values
  // only while the person has no unsaved edits: refilling on every reload
  // used to throw away what they were typing.
  useEffect(() => {
    if (!open) {
      filledFrom.current = null;
      return;
    }
    const last = filledFrom.current;
    if (
      last &&
      last.key === itemKey &&
      (last.signature === storedSignature || isDirty)
    )
      return;
    filledFrom.current = { key: itemKey, signature: storedSignature };
    setValues(JSON.parse(storedSignature) as FormValues);
    setInitialValues(storedSignature);
    setErrors({});
  }, [isDirty, itemKey, open, storedSignature]);

  useEffect(() => {
    if (!open || !isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, open]);

  const close = useCallback(() => {
    if (isDirty && !window.confirm("Discard unsaved item changes?")) return;
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const save = useCallback(async () => {
    if (!collection || !userId || savingRef.current) return;
    const validated = validateItemValues(fields, values);
    setErrors(validated.errors);
    if (Object.keys(validated.errors).length > 0) return;
    savingRef.current = true;
    setIsSaving(true);
    // Only the fields the person changed are written, and onto the stored
    // data: keys the form does not show (renamed fields, duplicated_from,
    // keys the AI or MCP tools wrote) survive, and so do changes the AI made
    // to other fields while the form was open.
    const initial = (initialValues ? JSON.parse(initialValues) : {}) as FormValues;
    const changedKeys = isCreate
      ? fields.map((field) => field.key)
      : fields
          .filter(
            (field) =>
              JSON.stringify(values[field.key] ?? null) !==
              JSON.stringify(initial[field.key] ?? null),
          )
          .map((field) => field.key);
    const data = mergeItemData(
      isCreate ? {} : item?.data,
      validated.data,
      changedKeys,
    ) as Json;
    const query = isCreate
      ? supabase
          .from("collection_items")
          .insert({
            user_id: userId,
            collection_id: collection.id,
            data,
            folder_id: folderId ?? null,
          })
          .select(ITEM_COLUMNS)
          .single()
      : supabase
          .from("collection_items")
          .update({ data })
          .eq("id", item?.id ?? "")
          .eq("user_id", userId)
          .select(ITEM_COLUMNS)
          .single();
    const { data: saved, error } = await query;
    savingRef.current = false;
    setIsSaving(false);
    if (error || !saved)
      return toast.error(
        isCreate ? "Could not create item" : "Could not save item",
        { description: dbErrorMessage(error, "Please try again.") },
      );
    const savedItem = saved as unknown as CollectionItem;
    if (!isCreate) {
      // The form now holds what was stored, so it is clean, and the reload
      // of this item that follows is not mistaken for someone else's edit.
      const signature = JSON.stringify(initialFormValues(fields, savedItem));
      filledFrom.current = { key: savedItem.id, signature };
      setValues(JSON.parse(signature) as FormValues);
      setInitialValues(signature);
    }
    toast.success(isCreate ? "Item created" : "Item saved");
    onSaved(savedItem);
    if (!inline) onOpenChange(false);
  }, [
    collection,
    fields,
    folderId,
    initialValues,
    inline,
    isCreate,
    item?.data,
    item?.id,
    onOpenChange,
    onSaved,
    userId,
    values,
  ]);

  const deleteItem = async () => {
    if (!item || isCreate) return;
    const { error } = await supabase
      .from("collection_items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", item.user_id);
    if (error)
      return toast.error("Could not delete item", {
        description: dbErrorMessage(error, "Please try again."),
      });
    toast.success("Item deleted");
    onDeleted(item.id);
    setDeleteOpen(false);
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        save();
      } else if (event.key === "Escape" && !inline) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, open, save, inline]);

  const title = isCreate
    ? `New item in ${collection?.name ?? "Collection"}`
    : item?.title || "Edit item";
  const subtitle = isDirty ? "Unsaved changes" : "Save changes when you are done.";

  const body = (
    <>
      <div className={cn("flex-1 overflow-y-auto", inline ? "px-6 py-6" : "-mx-6 px-6 py-4")}>
        <form
          className={cn("space-y-5", inline && "mx-auto max-w-2xl")}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={
                values[field.key] ??
                (field.type === "multiselect"
                  ? []
                  : field.type === "boolean"
                    ? false
                    : "")
              }
              error={errors[field.key]}
              collections={collections}
              currentCollection={collection}
              onChange={(value) => {
                setValues((current) => ({ ...current, [field.key]: value }));
                setErrors((current) => ({ ...current, [field.key]: "" }));
              }}
            />
          ))}
        </form>
        {!isCreate && item && collection && (
          <div className={cn(inline && "mx-auto max-w-2xl")}>
            <ItemNotesPanel
              itemId={item.id}
              itemTitle={item.title ?? "Untitled"}
              collectionId={collection.id}
              collectionName={collection.name}
              onClose={inline ? undefined : () => onOpenChange(false)}
            />
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t pt-4",
          inline && "px-6 pb-6",
        )}
      >
        <div>
          {!isCreate && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {inline ? "Back" : "Cancel"}
          </Button>
          <Button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this collection item. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold font-display">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          {!isCreate && item && onDuplicate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Item actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onDuplicate(item)}>
                  <Copy className="mr-2 h-4 w-4" /> Make a copy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {body}
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <SheetContent className="flex flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}



function EditCollectionDialog({
  collection,
  open,
  onOpenChange,
  onSaved,
}: {
  collection: Collection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (collection: Collection) => void;
}) {
  const [values, setValues] = useState({
    name: "",
    icon: "📚",
    description: "",
    visibility: "private" as "private" | "personal",
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof typeof values, string>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!collection || !open) return;
    setValues({
      name: collection.name,
      icon: collection.icon || "📚",
      description: collection.description || "",
      visibility: collection.visibility === "personal" ? "personal" : "private",
    });
    setErrors({});
  }, [collection, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!collection) return;
    const parsed = collectionFormSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof typeof values, string>> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path[0] as keyof typeof values | undefined;
        if (key) next[key] = issue.message;
      });
      setErrors(next);
      return;
    }
    setIsSubmitting(true);
    const { data, error } = await supabase
      .from("collections")
      .update({
        name: parsed.data.name,
        icon: parsed.data.icon || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      })
      .eq("id", collection.id)
      .eq("user_id", collection.user_id)
      .select("*")
      .single();
    setIsSubmitting(false);
    if (error || !data)
      return toast.error("Could not update collection", {
        description: "Please try again.",
      });
    toast.success("Collection updated");
    onSaved(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Collection</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={values.name}
              maxLength={60}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border text-lg hover:bg-accent",
                    values.icon === emoji && "border-primary bg-primary/10",
                  )}
                  onClick={() =>
                    setValues((current) => ({ ...current, icon: emoji }))
                  }
                >
                  {emoji}
                </button>
              ))}
            </div>
            <Input
              value={values.icon}
              maxLength={4}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  icon: event.target.value,
                }))
              }
              className="w-24"
            />
            {errors.icon && (
              <p className="text-xs text-destructive">{errors.icon}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={values.description}
              maxLength={200}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description}</p>
            )}
          </div>
          <RadioGroup
            value={values.visibility}
            onValueChange={(value) =>
              setValues((current) => ({
                ...current,
                visibility: value as "private" | "personal",
              }))
            }
          >
            <Label className="flex items-center gap-2 rounded-md border p-3">
              <RadioGroupItem value="private" /> Private (only me)
            </Label>
            <Label className="flex items-center gap-2 rounded-md border p-3">
              <RadioGroupItem value="personal" /> Personal (visible to my AI
              agents)
            </Label>
          </RadioGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilterRow({
  label,
  fieldType,
  options,
  filter,
  onChange,
}: {
  label: string;
  fieldType: string;
  options?: string[];
  filter: ColumnFilter;
  onChange: (filter: ColumnFilter) => void;
}) {
  const isNumeric = ["number", "currency"].includes(fieldType);
  const isDate = ["date", "datetime", "updated", "created"].includes(fieldType);
  const isBoolean = fieldType === "boolean";
  const isSet = ["select", "multiselect"].includes(fieldType) && (options?.length ?? 0) > 0;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {isNumeric && filter.type === "number" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={filter.min ?? ""}
            onChange={(e) =>
              onChange({
                type: "number",
                min: e.target.value === "" ? null : Number(e.target.value),
                max: filter.max,
              })
            }
            className="h-8"
          />
          <Input
            type="number"
            placeholder="Max"
            value={filter.max ?? ""}
            onChange={(e) =>
              onChange({
                type: "number",
                min: filter.min,
                max: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="h-8"
          />
        </div>
      )}
      {isDate && filter.type === "date" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={filter.from ?? ""}
            onChange={(e) =>
              onChange({
                type: "date",
                from: e.target.value || null,
                to: filter.to,
              })
            }
            className="h-8"
          />
          <Input
            type="date"
            value={filter.to ?? ""}
            onChange={(e) =>
              onChange({
                type: "date",
                from: filter.from,
                to: e.target.value || null,
              })
            }
            className="h-8"
          />
        </div>
      )}
      {isBoolean && filter.type === "boolean" && (
        <Select
          value={filter.value === null ? "any" : filter.value ? "yes" : "no"}
          onValueChange={(v) =>
            onChange({
              type: "boolean",
              value: v === "any" ? null : v === "yes",
            })
          }
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      )}
      {isSet && filter.type === "set" && (
        <div className="flex flex-wrap gap-1.5">
          {options!.map((option) => {
            const checked = filter.values.includes(option);
            return (
              <button
                type="button"
                key={option}
                onClick={() =>
                  onChange({
                    type: "set",
                    values: checked
                      ? filter.values.filter((v) => v !== option)
                      : [...filter.values, option],
                  })
                }
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs transition-colors",
                  checked
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}
      {!isNumeric && !isDate && !isBoolean && !isSet && filter.type === "text" && (
        <Input
          placeholder="Contains…"
          value={filter.value}
          onChange={(e) => onChange({ type: "text", value: e.target.value })}
          className="h-8"
        />
      )}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  align,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: string;
  align?: "left" | "right";
  sort: ColumnSort;
  onToggle: (key: string) => void;
}) {
  const active = sort?.key === sortKey;
  const Icon = active
    ? sort?.dir === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1 -mx-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors",
        align === "right" && "justify-end",
        active && "text-foreground",
      )}
    >
      <span>{label}</span>
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          active ? "opacity-100" : "opacity-40",
        )}
      />
    </button>
  );
}

export default function CollectionDetail() {
  const { slug } = useParams<{ slug: string }>();
  // The :slug and :slug/:itemId routes render this page as one instance that
  // React keeps across collections. A fresh instance per collection keeps one
  // collection's items, view settings and open item out of the next one.
  return <CollectionDetailPage key={slug} />;
}

function CollectionDetailPage() {
  const { slug, itemId: routeItemId } = useParams<{ slug: string; itemId?: string }>();
  const { user } = useAuth();
  // Loads depend on the id, not the user object: a token refresh must not
  // reload the page under an open editor.
  const userId = user?.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [collection, setCollection] = useState<Collection | null>(null);
  // Every loaded item of the collection, in the base sort order. Search,
  // column filters, column sort and paging all work on this in memory, so
  // typing in a search box does not download the collection again.
  const [rows, setRows] = useState<CollectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // A failed load is shown as a failure with Retry, never as an empty
  // collection ("No items yet") that invites creating it all again.
  const [collectionLoadFailure, setCollectionLoadFailure] = useState<
    "error" | "missing" | null
  >(null);
  const [itemsLoadFailed, setItemsLoadFailed] = useState(false);
  const itemsLoadedOnce = useRef(false);
  const [query, setQuery] = useState("");
  // The saved view is read before the first load, so a saved sort does not
  // load the whole collection twice (once in the default order).
  const [storedView] = useState(() => readStoredView(slug));
  const [sort, setSort] = useState<SortKey>(storedView.sort ?? "updated");
  const [visibleKeys, setVisibleKeys] = useState<string[]>(
    storedView.visibleKeys ?? [],
  );
  const [columnSort, setColumnSort] = useState<ColumnSort>(
    storedView.columnSort ?? null,
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(
    storedView.columnFilters ?? {},
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [truncatedByLimit, setTruncatedByLimit] = useState(false);
  const [cursorStack, setCursorStack] = useState<Cursor[]>([]);
  // Tree data (full item set + folders for the collection) is loaded separately
  // from the paged/filtered `items` used by the table view — the tree needs the
  // full picture, and refreshing it independently avoids resetting pagination.
  const [treeItems, setTreeItems] = useState<ItemLite[]>([]);
  const [confirm, confirmDialog] = useConfirmDialog();
  const [folders, setFolders] = useState<FolderLite[]>([]);
  const [treeReloadTick, setTreeReloadTick] = useState(0);
  const refreshTree = useCallback(
    () => setTreeReloadTick((t) => t + 1),
    [],
  );
  const openItem = useCallback(
    (item: { id: string }, targetSlug: string = slug ?? "") => {
      navigate(`/collections/${targetSlug}/${item.id}`);
      // Fire-and-forget last_viewed_at stamp so the tree's Recent section is
      // populated. Silent failures are fine — this is a UX signal, not data.
      if (item.id && item.id !== "new") {
        supabase
          .from("collection_items")
          .update({ last_viewed_at: new Date().toISOString() })
          .eq("id", item.id)
          .then(({ error }) => {
            if (!error) {
              setTreeItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? { ...row, last_viewed_at: new Date().toISOString() }
                    : row,
                ),
              );
            }
          });
      }
    },
    [navigate, slug],
  );
  const closeItem = useCallback(
    () => navigate(`/collections/${slug}`),
    [navigate, slug],
  );
  // `folderId` is set by "New item here" on a folder; the item is created
  // in that folder instead of at the top level.
  const openNewItem = useCallback(
    (folderId?: string | null) =>
      navigate(
        `/collections/${slug}/new${folderId ? `?folder=${encodeURIComponent(folderId)}` : ""}`,
      ),
    [navigate, slug],
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tableDeleteTarget, setTableDeleteTarget] = useState<CollectionItem | null>(null);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const collectionId = collection?.id;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { collectionId?: string } | undefined;
      if (!detail?.collectionId || !collectionId || detail.collectionId === collectionId) {
        setReloadTick((t) => t + 1);
      }
    };
    window.addEventListener("menerio:collection-updated", handler);
    return () => window.removeEventListener("menerio:collection-updated", handler);
  }, [collectionId]);
  const retryLoad = useCallback(() => {
    setCollectionLoadFailure(null);
    setItemsLoadFailed(false);
    setIsLoading(true);
    setReloadTick((t) => t + 1);
  }, []);

  // The open item follows the URL (/collections/:slug/:itemId), so deep links
  // and the back button work and the AI chat can read the item from the route.
  //   - "new" → a placeholder for the create form
  //   - an id → that row of this collection, or the row fetched by id when it
  //     is not among the loaded rows (past the load cap)
  //   - none → the table
  // Derived rather than copied into state, so a reload of the rows hands the
  // editor the fresh row, and the editor decides whether to take it.
  const [fetchedItem, setFetchedItem] = useState<CollectionItem | null>(null);
  const newItemPlaceholder = useMemo(
    () =>
      collectionId && userId
        ? ({
            id: "new",
            collection_id: collectionId,
            user_id: userId,
            data: {},
            title: null,
            created_at: "",
            updated_at: "",
            folder_id: null,
            is_favorite: false,
            last_viewed_at: null,
            indexable_date_1: null,
            indexable_date_2: null,
            indexable_number_1: null,
            indexable_number_2: null,
            indexable_text_1: null,
            search_vector: null,
          } as CollectionItem)
        : null,
    [collectionId, userId],
  );
  const loadedItem =
    routeItemId && routeItemId !== "new"
      ? (rows.find((row) => row.id === routeItemId) ?? null)
      : null;
  const hasFetchedItem = !!routeItemId && fetchedItem?.id === routeItemId;
  const selectedItem: CollectionItem | null = !routeItemId
    ? null
    : routeItemId === "new"
      ? newItemPlaceholder
      : (loadedItem ?? (hasFetchedItem ? fetchedItem : null));
  const needsItemFetch =
    !!routeItemId && routeItemId !== "new" && !loadedItem && !hasFetchedItem;
  useEffect(() => {
    if (!needsItemFetch || !routeItemId || !userId || !collectionId || isLoading)
      return;
    let cancelled = false;
    supabase
      .from("collection_items")
      .select(ITEM_COLUMNS)
      .eq("id", routeItemId)
      .eq("user_id", userId)
      // Only an item of this collection. An id from another collection used
      // to open under this collection's fields, and saving it wrote this
      // schema's keys into the other collection's item.
      .eq("collection_id", collectionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          if (error)
            toast.error("Could not open the item", {
              description: dbErrorMessage(error, "Please try again."),
            });
          else toast.error("Item not found");
          navigate(`/collections/${slug}`, { replace: true });
          return;
        }
        setFetchedItem(data as unknown as CollectionItem);
      });
    return () => {
      cancelled = true;
    };
  }, [needsItemFetch, routeItemId, userId, collectionId, isLoading, navigate, slug]);
  const folderParam = searchParams.get("folder");
  const newItemFolderId =
    folderParam && folders.some((folder) => folder.id === folderParam)
      ? folderParam
      : null;


  const [linkValidity, setLinkValidity] =
    useState<LinkValidity>(emptyLinkValidity);
  const fields = useMemo(
    () => parseSchema(collection?.field_schema ?? []),
    [collection?.field_schema],
  );
  const primaryField = fields.find((field) => field.primary);
  const nonPrimaryFields = fields.filter((field) => !field.primary);
  const visibleFields = nonPrimaryFields.filter((field) =>
    visibleKeys.includes(field.key),
  );
  const fieldByKey = useMemo(() => {
    const map = new Map<string, SchemaField>();
    fields.forEach((f) => map.set(f.key, f));
    return map;
  }, [fields]);
  const activeFilterCount = countActiveFilters(columnFilters);
  const clientSideMode = columnSort !== null || activeFilterCount > 0;

  useEffect(() => {
    if (visibleKeys.length || nonPrimaryFields.length === 0) return;
    setVisibleKeys(nonPrimaryFields.slice(0, 5).map((field) => field.key));
  }, [nonPrimaryFields, visibleKeys.length]);

  useEffect(() => {
    if (!slug) return;
    try {
      localStorage.setItem(
        `collection:${slug}:view`,
        JSON.stringify({ sort, columnSort, columnFilters, visibleKeys }),
      );
    } catch {
      // ignore
    }
  }, [slug, sort, columnSort, columnFilters, visibleKeys]);

  useEffect(() => {
    setCursorStack([]);
  }, [query, sort, slug, clientSideMode, columnSort, columnFilters]);

  const toggleColumnSort = (key: string) => {
    setColumnSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const setColumnFilter = (key: string, filter: ColumnFilter) => {
    setColumnFilters((current) => ({ ...current, [key]: filter }));
  };

  const clearColumnFilters = () => setColumnFilters({});


  // Loads the collection and all its items. Runs on open, on a new base
  // sort, and on a reload (Retry, or the AI chat changing the collection);
  // search and column filters work on the loaded rows and never refetch.
  useEffect(() => {
    if (!userId || !slug) return;
    let cancelled = false;
    const load = async () => {
      // Only a first load shows skeletons. A reload keeps the table and the
      // tree (with its open folders) on screen until the new rows arrive.
      if (!itemsLoadedOnce.current) setIsLoading(true);
      const { data: current, error } = await supabase
        .from("collections")
        .select("*")
        .eq("user_id", userId)
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (error || !current) {
        if (error && itemsLoadedOnce.current) {
          toast.error("Could not refresh the collection", {
            description: dbErrorMessage(error, "Please try again."),
          });
        } else {
          setCollection(null);
          setCollectionLoadFailure(error ? "error" : "missing");
        }
        setIsLoading(false);
        return;
      }
      setCollection(current);
      const { data: collectionRows } = await supabase
        .from("collections")
        .select("*")
        .eq("user_id", userId)
        .order("name");
      if (!cancelled) setAllCollections(collectionRows ?? [current]);

      // Pull the whole collection in chunks, ordered by the chosen base sort,
      // up to the safety cap. Fetching everything is what lets the sort and
      // filters below be correct: the previous code sorted only the first page
      // (or the first 500 in filter mode) and silently dropped the rest.
      const loaded: CollectionItem[] = [];
      let truncated = false;
      let itemsError: unknown = null;
      for (let from = 0; from < MAX_CLIENT_ROWS; from += FETCH_CHUNK) {
        let request = supabase
          .from("collection_items")
          .select(ITEM_COLUMNS)
          .eq("user_id", userId)
          .eq("collection_id", current.id)
          .range(from, from + FETCH_CHUNK - 1);
        if (sort === "updated")
          request = request
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false });
        if (sort === "created")
          request = request
            .order("created_at", { ascending: false })
            .order("id", { ascending: false });
        if (sort === "alpha")
          request = request
            .order("title", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true });
        const { data: chunk, error } = await request;
        if (cancelled) return;
        if (error) {
          itemsError = error;
          break;
        }
        loaded.push(...((chunk ?? []) as unknown as CollectionItem[]));
        if (!chunk || chunk.length < FETCH_CHUNK) break;
        if (loaded.length >= MAX_CLIENT_ROWS) {
          truncated = true;
          break;
        }
      }
      if (itemsError) {
        if (itemsLoadedOnce.current)
          toast.error("Could not refresh the items", {
            description: dbErrorMessage(itemsError, "Please try again."),
          });
        else setItemsLoadFailed(true);
      } else {
        itemsLoadedOnce.current = true;
        setItemsLoadFailed(false);
        setRows(loaded);
        setTruncatedByLimit(truncated);
      }
      setIsLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [userId, slug, sort, reloadTick]);

  // Search, column filters and column sort, applied to the loaded rows.
  const workingSet = useMemo(() => {
    const searchableFields = fields.filter((field) =>
      ["text", "longtext"].includes(field.type),
    );
    const needle = query.trim().toLowerCase();
    let filtered: CollectionItem[] = needle
      ? rows.filter((item) =>
          [
            item.title,
            ...searchableFields.map((field) => asData(item.data)[field.key]),
          ].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(needle),
          ),
        )
      : rows;

    if (clientSideMode) {
      // Apply column filters
      filtered = filtered.filter((item) => {
        return Object.entries(columnFilters).every(([key, filter]) => {
          if (!isFilterActive(filter)) return true;
          let fieldType: string;
          let value: unknown;
          if (key === TITLE_KEY) {
            fieldType = "text";
            value = item.title ?? "";
          } else if (key === UPDATED_KEY) {
            fieldType = "updated";
            value = item.updated_at;
          } else {
            const f = fields.find((s) => s.key === key);
            if (!f) return true;
            fieldType = f.type;
            value = asData(item.data)[key];
          }
          return matchesFilter(fieldType, value, filter);
        });
      });
      // Apply column sort
      if (columnSort) {
        const { key, dir } = columnSort;
        let fieldType: string;
        if (key === TITLE_KEY) fieldType = "text";
        else if (key === UPDATED_KEY) fieldType = "updated";
        else
          fieldType = fields.find((s) => s.key === key)?.type ?? "text";
        const sign = dir === "asc" ? 1 : -1;
        filtered = [...filtered].sort((a, b) => {
          let av: unknown;
          let bv: unknown;
          if (key === TITLE_KEY) {
            av = a.title ?? "";
            bv = b.title ?? "";
          } else if (key === UPDATED_KEY) {
            av = a.updated_at;
            bv = b.updated_at;
          } else {
            av = asData(a.data)[key];
            bv = asData(b.data)[key];
          }
          return sign * compareValues(av, bv, fieldType);
        });
      }
    }
    return filtered;
  }, [rows, fields, query, clientSideMode, columnFilters, columnSort]);

  // Client-side pagination over the working set. cursorStack's length is the
  // page index, so Previous/Next push and pop and a page turn never refetches.
  const pageIndex = cursorStack.length;
  const items = useMemo(
    () => workingSet.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
    [workingSet, pageIndex],
  );
  const hasNextPage = workingSet.length > (pageIndex + 1) * PAGE_SIZE;

  // The linked ids on the current page, as a stable key, so the existence
  // check reruns when the links change rather than on every render of a page.
  const linkIdsKey = useMemo(() => {
    const links = items
      .flatMap((item) => Object.values(asData(item.data)))
      .filter(isLinkValue);
    const idsOf = (type: LinkValue["type"]) =>
      [...new Set(links.filter((link) => link.type === type).map((link) => link.id))].sort();
    return JSON.stringify([idsOf("note"), idsOf("person"), idsOf("collection_item")]);
  }, [items]);

  useEffect(() => {
    const [noteIds, personIds, itemIds] = JSON.parse(linkIdsKey) as [
      string[],
      string[],
      string[],
    ];
    if (!userId || noteIds.length + personIds.length + itemIds.length === 0) {
      setLinkValidity(emptyLinkValidity());
      return;
    }
    let cancelled = false;
    const load = async () => {
      const [notes, people, linkedItems] = await Promise.all([
        noteIds.length
          ? supabase
              .from("notes")
              .select("id")
              .eq("user_id", userId)
              .in("id", noteIds)
              .eq("is_trashed", false)
          : Promise.resolve({ data: [] }),
        personIds.length
          ? supabase
              .from("contacts")
              .select("id")
              .eq("user_id", userId)
              .in("id", personIds)
              .is("merged_into", null)
          : Promise.resolve({ data: [] }),
        itemIds.length
          ? supabase
              .from("collection_items")
              .select("id")
              .eq("user_id", userId)
              .in("id", itemIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (!cancelled)
        setLinkValidity({
          notes: new Set((notes.data ?? []).map((row) => row.id)),
          people: new Set((people.data ?? []).map((row) => row.id)),
          items: new Set((linkedItems.data ?? []).map((row) => row.id)),
        });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [linkIdsKey, userId]);

  const duplicateItem = async (item: CollectionItem) => {
    if (!userId || !collection) return;
    // Same container (collection + folder), Obsidian-style " N" title suffix,
    // favorite/last-viewed reset, provenance recorded in the item data.
    const siblingTitles = new Set(
      treeItems
        .filter((row) => (row.folder_id ?? null) === (item.folder_id ?? null))
        .map((row) => (row.title ?? "").trim())
        .filter(Boolean),
    );
    const nextTitle = item.title
      ? nextDuplicateTitle(item.title, siblingTitles)
      : null;
    const { data: created, error } = await supabase
      .from("collection_items")
      .insert({
        user_id: userId,
        collection_id: collection.id,
        // The database derives the title from the primary field, so the
        // " 2" suffix goes there; a title column value would be overwritten.
        data: duplicateItemData(item.data, item.id, primaryField, nextTitle) as Json,
        folder_id: item.folder_id ?? null,
        is_favorite: false,
      })
      .select(ITEM_COLUMNS)
      .single();
    if (error || !created)
      return toast.error("Could not make a copy", {
        description: dbErrorMessage(error, "Please try again."),
      });
    toast.success("Made a copy");
    const copy = created as unknown as CollectionItem;
    setRows((current) => [copy, ...current.filter((row) => row.id !== copy.id)]);
    refreshTree();
    openItem(copy);
  };

  const handleDuplicateItemFromTree = useCallback(
    async (itemId: string) => {
      const target = rows.find((row) => row.id === itemId);
      if (target) {
        await duplicateItem(target);
        return;
      }
      const { data, error } = await supabase
        .from("collection_items")
        .select(ITEM_COLUMNS)
        .eq("id", itemId)
        .eq("collection_id", collection?.id ?? "")
        .maybeSingle();
      if (error || !data) {
        toast.error("Could not make a copy", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      await duplicateItem(data as unknown as CollectionItem);
    },
    // duplicateItem is re-created per render but only closes over stable state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, treeItems, userId, collection],
  );

  // Drops a deleted item from the table and the tree, wherever the delete
  // started (table row, tree, open item), and even when the row is not on
  // the table's current page.
  const removeItemLocally = useCallback(
    (itemId: string) => {
      setRows((current) => current.filter((row) => row.id !== itemId));
      setTreeItems((current) => current.filter((row) => row.id !== itemId));
      refreshTree();
    },
    [refreshTree],
  );

  const deleteItemById = useCallback(
    async (itemId: string): Promise<boolean> => {
      if (!userId) return false;
      const { error } = await supabase
        .from("collection_items")
        .delete()
        .eq("id", itemId)
        .eq("user_id", userId);
      if (error) {
        toast.error("Could not delete item", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return false;
      }
      removeItemLocally(itemId);
      toast.success("Item deleted");
      return true;
    },
    [removeItemLocally, userId],
  );

  const deleteCollection = async () => {
    if (!collection) return;
    const { error: itemsError } = await supabase
      .from("collection_items")
      .delete()
      .eq("collection_id", collection.id)
      .eq("user_id", collection.user_id);
    if (itemsError)
      return toast.error("Could not delete collection items", {
        description: dbErrorMessage(itemsError, "Please try again."),
      });
    const { error } = await supabase
      .from("collections")
      .delete()
      .eq("id", collection.id)
      .eq("user_id", collection.user_id);
    if (error)
      return toast.error("Could not delete collection", {
        description: dbErrorMessage(error, "Please try again."),
      });
    toast.success("Collection deleted");
    navigate("/collections");
  };

  const openLinkedEntity = async (link: LinkValue) => {
    if (link.label === "[deleted]") return;
    if (link.type === "note") {
      window.open(
        `/dashboard/notes/${link.id}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (link.type === "person") {
      window.open(
        `/dashboard/people?contact=${link.id}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    const existing = rows.find((item) => item.id === link.id);
    if (existing) {
      openItem(existing);
      return;
    }
    const { data, error } = await supabase
      .from("collection_items")
      .select("id, collection_id")
      .eq("id", link.id)
      .maybeSingle();
    if (error || !data) return toast.error("Linked item not found");
    if (data.collection_id === collection?.id) {
      openItem(data);
      return;
    }
    // An item of another collection opens under its own collection's URL and
    // fields. Opening it here showed it with this collection's fields, and
    // saving wrote this schema's keys into it.
    let targetSlug = allCollections.find(
      (candidate) => candidate.id === data.collection_id,
    )?.slug;
    if (!targetSlug) {
      const { data: target } = await supabase
        .from("collections")
        .select("slug")
        .eq("id", data.collection_id)
        .maybeSingle();
      targetSlug = target?.slug;
    }
    if (!targetSlug) return toast.error("Linked item not found");
    openItem(data, targetSlug);
  };


  // Load full item set (id/title/folder/favorite/recent-viewed) + folders for
  // the sidebar tree. This runs in parallel with the paged/filtered `items`
  // load and refreshes whenever an item/folder is mutated via the tree.
  useEffect(() => {
    if (!userId || !collectionId) {
      setTreeItems([]);
      setFolders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Paged with a total order: an unpaged select stops at PostgREST's
      // 1,000-row cap in no fixed order, so large collections silently lost
      // tree entries.
      const [itemsRes, foldersRes] = await Promise.allSettled([
        fetchAllPages<ItemLite>((from, to) =>
          supabase
            .from("collection_items")
            .select("id, title, folder_id, is_favorite, last_viewed_at, updated_at")
            .eq("user_id", userId)
            .eq("collection_id", collectionId)
            .order("id")
            .range(from, to),
        ),
        fetchAllPages<FolderLite>((from, to) =>
          supabase
            .from("collection_item_folders")
            .select("id, name, parent_folder_id")
            .eq("user_id", userId)
            .eq("collection_id", collectionId)
            .order("name")
            .order("id")
            .range(from, to),
        ),
      ]);
      if (cancelled) return;
      if (itemsRes.status === "rejected" || foldersRes.status === "rejected") {
        toast.error("Could not load the item tree", { description: "Reload the page to try again." });
      }
      if (itemsRes.status === "fulfilled") setTreeItems(itemsRes.value);
      if (foldersRes.status === "fulfilled") setFolders(foldersRes.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, collectionId, treeReloadTick, reloadTick]);

  const handleToggleFavorite = useCallback(
    async (id: string, isFavorite: boolean) => {
      // Optimistic — favorite is a fire-and-forget UX flag.
      setTreeItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, is_favorite: isFavorite } : row)),
      );
      const { error } = await supabase
        .from("collection_items")
        .update({ is_favorite: isFavorite })
        .eq("id", id);
      if (error) {
        toast.error("Could not update favorite", {
          description: dbErrorMessage(error, "Please try again."),
        });
        refreshTree();
      }
    },
    [refreshTree],
  );

  const handleCreateFolder = useCallback(
    async (parentFolderId: string | null) => {
      if (!user || !collection) return;
      const name = window.prompt(parentFolderId ? "New subfolder name" : "New folder name");
      if (!name || !name.trim()) return;
      const { error } = await supabase.from("collection_item_folders").insert({
        user_id: user.id,
        collection_id: collection.id,
        parent_folder_id: parentFolderId,
        name: name.trim(),
      });
      if (error) {
        toast.error("Could not create folder", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      toast.success("Folder created");
      refreshTree();
    },
    [user, collection, refreshTree],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, currentName: string) => {
      const name = window.prompt("Rename folder", currentName);
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === currentName) return;
      const { error } = await supabase
        .from("collection_item_folders")
        .update({ name: trimmed })
        .eq("id", folderId);
      if (error) {
        toast.error("Could not rename folder", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      refreshTree();
    },
    [refreshTree],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      // FK is ON DELETE SET NULL for items and child folders, so items and
      // subfolders survive and reappear at the parent level. Confirm since
      // the tree structure changes.
      if (!(await confirm({ title: "Delete this folder?", description: "Its items and subfolders move up one level.", confirmLabel: "Delete folder", destructive: true }))) return;
      const { error } = await supabase
        .from("collection_item_folders")
        .delete()
        .eq("id", folderId);
      if (error) {
        toast.error("Could not delete folder", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      toast.success("Folder deleted");
      refreshTree();
    },
    [refreshTree, confirm],
  );

  const handleReparentFolder = useCallback(
    async (folderId: string, parentFolderId: string | null) => {
      const { error } = await supabase
        .from("collection_item_folders")
        .update({ parent_folder_id: parentFolderId })
        .eq("id", folderId);
      if (error) {
        toast.error("Could not move folder", {
          description: dbErrorMessage(error, "Please try again."),
        });
        return;
      }
      refreshTree();
    },
    [refreshTree],
  );

  const handleMoveItemToFolder = useCallback(
    async (itemId: string, folderId: string | null) => {
      setTreeItems((prev) =>
        prev.map((row) => (row.id === itemId ? { ...row, folder_id: folderId } : row)),
      );
      const { error } = await supabase
        .from("collection_items")
        .update({ folder_id: folderId })
        .eq("id", itemId);
      if (error) {
        toast.error("Could not move item", {
          description: dbErrorMessage(error, "Please try again."),
        });
        refreshTree();
      }
    },
    [refreshTree],
  );

  const handleDeleteItemFromTree = useCallback(
    async (itemId: string) => {
      if (!(await confirm({ title: "Delete this item?", description: "This permanently deletes the item. It cannot be undone.", confirmLabel: "Delete", destructive: true }))) return;
      // A failed delete keeps the item open instead of closing it as if gone.
      if (!(await deleteItemById(itemId))) return;
      if (routeItemId === itemId) closeItem();
    },
    [routeItemId, closeItem, confirm, deleteItemById],
  );

  if (isLoading && !collection)
    return (
      <div className="w-full max-w-6xl space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );

  if (!collection)
    return (
      <div className="w-full max-w-6xl">
        <SEOHead title="Collection - Menerio" noIndex />
        <LoadErrorState
          title={
            collectionLoadFailure === "missing"
              ? "This collection could not be found."
              : "The collection could not be loaded."
          }
          description={
            collectionLoadFailure === "missing"
              ? "It may have been renamed or deleted."
              : undefined
          }
          onRetry={collectionLoadFailure === "missing" ? undefined : retryLoad}
          backTo="/collections"
          backLabel="Back to Collections"
        />
      </div>
    );

  return (
    <div className="flex h-[calc(100dvh-104px)] w-full flex-col overflow-hidden rounded-md border bg-background lg:flex-row">
      <SEOHead
        title={`${collection?.name ?? "Collection"} — Menerio`}
        noIndex
      />
      <CollectionItemsTree
        collection={collection}
        folders={folders}
        treeItems={treeItems}
        selectedItemId={routeItemId ?? null}
        query={query}
        onQueryChange={setQuery}
        onSelectItem={openItem}
        onNewItem={openNewItem}
        isLoading={isLoading}
        onToggleFavorite={handleToggleFavorite}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onReparentFolder={handleReparentFolder}
        onMoveItemToFolder={handleMoveItemToFolder}
        onDuplicateItem={handleDuplicateItemFromTree}
        onDeleteItem={handleDeleteItemFromTree}
      />
      <section className="min-w-0 flex-1 overflow-y-auto p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <Link to="/collections" className="hover:text-foreground">
              Collections
            </Link>{" "}
            /{" "}
            {selectedItem ? (
              <>
                <Link to={`/collections/${slug}`} className="hover:text-foreground">
                  {collection?.name}
                </Link>{" "}
                /{" "}
                <span className="text-foreground">
                  {selectedItem.id === "new"
                    ? "New item"
                    : selectedItem.title || "Untitled"}
                </span>
              </>
            ) : (
              collection?.name
            )}
          </p>
          {!selectedItem && (
            <>
              <h1 className="mt-2 text-3xl font-bold font-display">
                <CollectionIcon
                  icon={collection?.icon}
                  className="mr-2 inline-flex h-8 w-8 align-[-0.15em]"
                />
                {collection?.name}
              </h1>
              {collection?.description && (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {collection.description}
                </p>
              )}
            </>
          )}
        </div>
        {!selectedItem && (
          <div className="flex items-center gap-2">
            <Button onClick={() => openNewItem()}>
              <Plus className="mr-2 h-4 w-4" />
              New Item
            </Button>

            <Button
              variant="outline"
              onClick={() => setChatOpen((v) => !v)}
              aria-label="AI chat"
              aria-pressed={chatOpen}
            >
              <Sparkles className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">AI Chat</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/collections/${slug}/schema`)}
              aria-label="Customize fields"
            >
              <Settings2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Customize</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Collection actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  Edit Collection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete Collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {selectedItem && (
        <ItemSheet
          inline
          collection={collection}
          fields={fields}
          item={selectedItem}
          onDuplicate={(target) => duplicateItem(target)}
          open={true}
          onOpenChange={(open) => {
            if (!open) closeItem();
          }}
          onSaved={(savedItem) => {
            setRows((current) =>
              current.some((row) => row.id === savedItem.id)
                ? current.map((row) =>
                    row.id === savedItem.id ? savedItem : row,
                  )
                : [savedItem, ...current],
            );
            setFetchedItem((current) =>
              current?.id === savedItem.id ? savedItem : current,
            );
            // The tree lists the new item and shows titles, which the
            // primary field decides.
            refreshTree();
            // If this was a create, route to the newly created item so the AI
            // FAB can prime item context and further edits happen in place.
            if (selectedItem?.id === "new") {
              navigate(`/collections/${slug}/${savedItem.id}`, { replace: true });
            }
          }}
          onDeleted={(id) => {
            removeItemLocally(id);
            closeItem();
          }}
          folderId={selectedItem.id === "new" ? newItemFolderId : null}
          collections={allCollections}
        />
      )}
      {!selectedItem && (
      <>
      {itemsLoadFailed ? (
        <LoadErrorState
          className="min-h-[50vh]"
          title="The items could not be loaded."
          onRetry={retryLoad}
        />
      ) : rows.length === 0 && !isLoading ? (
        <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
          <div className="max-w-lg">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CollectionIcon icon={collection?.icon} className="h-9 w-9" />
            </div>
            <h2 className="text-2xl font-bold font-display">No items yet</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Add your first item, or describe one to your AI assistant. It
              will know how to capture it here.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3">
              <Button onClick={() => openNewItem()}>

                <Plus className="mr-2 h-4 w-4" />
                New Item
              </Button>
              <button
                type="button"
                onClick={() => navigate(`/collections/${slug}/schema`)}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Customize fields & categories
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search items"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search items"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={columnSort ? "custom" : sort}
                onValueChange={(value) => {
                  if (value === "custom") return;
                  setColumnSort(null);
                  setSort(value as SortKey);
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Recently updated</SelectItem>
                  <SelectItem value="created">Recently added</SelectItem>
                  <SelectItem value="alpha">Alphabetical</SelectItem>
                  {columnSort && (
                    <SelectItem value="custom">
                      Custom: {columnSort.key === TITLE_KEY
                        ? "Title"
                        : columnSort.key === UPDATED_KEY
                          ? "Updated"
                          : fieldByKey.get(columnSort.key)?.label ?? columnSort.key}
                      {" "}({columnSort.dir})
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="h-5 px-1.5">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[22rem] max-h-[70vh] overflow-y-auto">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Filters</span>
                      {activeFilterCount > 0 && (
                        <button
                          type="button"
                          onClick={clearColumnFilters}
                          className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {/* Title filter */}
                    <FilterRow
                      label="Title"
                      fieldType="text"
                      filter={columnFilters[TITLE_KEY] ?? defaultFilterFor("text")}
                      onChange={(f) => setColumnFilter(TITLE_KEY, f)}
                    />
                    {nonPrimaryFields.map((field) => (
                      <FilterRow
                        key={field.key}
                        label={field.label}
                        fieldType={field.type}
                        options={field.options}
                        filter={
                          columnFilters[field.key] ?? defaultFilterFor(field.type)
                        }
                        onChange={(f) => setColumnFilter(field.key, f)}
                      />
                    ))}
                    <FilterRow
                      label="Updated"
                      fieldType="date"
                      filter={columnFilters[UPDATED_KEY] ?? defaultFilterFor("date")}
                      onChange={(f) => setColumnFilter(UPDATED_KEY, f)}
                    />
                  </div>
                </PopoverContent>
              </Popover>
              {nonPrimaryFields.length > 5 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Columns</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64">
                    <div className="space-y-3">
                      {nonPrimaryFields.map((field) => (
                        <Label
                          key={field.key}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={visibleKeys.includes(field.key)}
                            onCheckedChange={(checked) =>
                              setVisibleKeys((current) =>
                                checked
                                  ? [...current, field.key]
                                  : current.filter((key) => key !== field.key),
                              )
                            }
                          />
                          {field.label}
                        </Label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
          {truncatedByLimit && (
            <p className="text-xs text-muted-foreground">
              This collection has more than {MAX_CLIENT_ROWS.toLocaleString()} items; only the
              first {MAX_CLIENT_ROWS.toLocaleString()} are loaded here. Narrow with search or a
              filter to reach the rest.
            </p>
          )}
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortableHeader
                      label="Title"
                      sortKey={TITLE_KEY}
                      sort={columnSort}
                      onToggle={toggleColumnSort}
                    />
                  </TableHead>
                  {visibleFields.map((field) => (
                    <TableHead
                      key={field.key}
                      className={cn(
                        ["number", "currency"].includes(field.type) &&
                          "text-right",
                      )}
                    >
                      <SortableHeader
                        label={field.label}
                        sortKey={field.key}
                        align={
                          ["number", "currency"].includes(field.type)
                            ? "right"
                            : "left"
                        }
                        sort={columnSort}
                        onToggle={toggleColumnSort}
                      />
                    </TableHead>
                  ))}
                  <TableHead>
                    <SortableHeader
                      label="Updated"
                      sortKey={UPDATED_KEY}
                      sort={columnSort}
                      onToggle={toggleColumnSort}
                    />
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: visibleFields.length + 3 }).map(
                        (__, cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ),
                      )}
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={visibleFields.length + 3}
                      className="py-12 text-center text-muted-foreground"
                    >
                      No matching items.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const data = asData(item.data);
                    return (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        onClick={() => openItem(item)}

                      >
                        <TableCell className="font-medium">
                          {item.title ||
                            (primaryField
                              ? truncate(data[primaryField.key])
                              : "Untitled") ||
                            "Untitled"}
                        </TableCell>
                        {visibleFields.map((field) => (
                          <TableCell
                            key={field.key}
                            className={cn(
                              ["number", "currency"].includes(field.type) &&
                                "text-right",
                            )}
                          >
                            <FieldValue
                              field={field}
                              value={data[field.key]}
                              collections={allCollections}
                              linkValidity={linkValidity}
                              onOpenLink={openLinkedEntity}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(item.updated_at), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button aria-label="Item actions" variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openItem(item)}
                              >

                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => duplicateItem(item)}
                              >
                                <Copy className="mr-2 h-4 w-4" /> Make a copy
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setTableDeleteTarget(item)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cursorStack.length === 0}
              onClick={() => setCursorStack((current) => current.slice(0, -1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNextPage}
              onClick={() =>
                setCursorStack((current) => [
                  ...current,
                  { updated_at: "", id: "" },
                ])
              }
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      </section>

      <EditCollectionDialog
        collection={collection}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={setCollection}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this collection and all items inside it.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteCollection}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Table-row delete confirmation — the tree and item sheet already
          confirm; the table row was the one hard-delete path that did not. */}
      <AlertDialog
        open={!!tableDeleteTarget}
        onOpenChange={(open) => { if (!open) setTableDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes
              {tableDeleteTarget?.title ? ` "${tableDeleteTarget.title}"` : " this item"}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (tableDeleteTarget) deleteItemById(tableDeleteTarget.id);
                setTableDeleteTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {chatOpen && collection && (
        <div className="fixed inset-y-0 right-0 z-50 flex">
          <CollectionChatPanel
            collectionId={collection.id}
            collectionName={collection.name}
            itemId={selectedItem && selectedItem.id !== "new" ? selectedItem.id : null}
            onClose={() => setChatOpen(false)}
            onCollectionChanged={() => setReloadTick((t) => t + 1)}
          />
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
