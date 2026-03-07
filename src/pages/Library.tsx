import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Trash2,
  Heart,
  Copy,
  FolderOpen,
  X,
  SlidersHorizontal,
  Rocket,
  Crown,
  Clock,
  Star,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// --- Mock data ---
interface LibraryItem {
  id: string;
  title: string;
  description: string;
  category: string;
  createdAt: string;
  isFavorite: boolean;
}

const CATEGORIES = ["All", "Design", "Development", "Marketing", "Research", "Personal"];

const MOCK_ITEMS: LibraryItem[] = [
  { id: "1", title: "Brand Guidelines", description: "Complete brand identity system including colors, typography, and logo usage rules.", category: "Design", createdAt: "2026-03-05", isFavorite: true },
  { id: "2", title: "API Integration Plan", description: "Technical spec for third-party API integrations and data flow architecture.", category: "Development", createdAt: "2026-03-04", isFavorite: false },
  { id: "3", title: "Q1 Campaign Strategy", description: "Marketing campaign strategy for Q1 with target audience analysis and KPIs.", category: "Marketing", createdAt: "2026-03-03", isFavorite: false },
  { id: "4", title: "User Research Findings", description: "Summary of user interviews and usability testing sessions with key insights.", category: "Research", createdAt: "2026-03-02", isFavorite: true },
  { id: "5", title: "Component Library", description: "Reusable UI component library documentation with usage examples.", category: "Design", createdAt: "2026-03-01", isFavorite: false },
  { id: "6", title: "Sprint Retrospective Notes", description: "Key takeaways from team retrospective on workflow improvements.", category: "Development", createdAt: "2026-02-28", isFavorite: false },
  { id: "7", title: "SEO Audit Report", description: "Comprehensive SEO audit with actionable recommendations for improvement.", category: "Marketing", createdAt: "2026-02-27", isFavorite: true },
  { id: "8", title: "Personal Reading List", description: "Curated list of articles and books on product management and leadership.", category: "Personal", createdAt: "2026-02-26", isFavorite: false },
];

const PAGE_SIZE = 6;

const SORT_OPTIONS = [
  { value: "recent", label: "Most Recent" },
  { value: "alpha", label: "Alphabetical" },
  { value: "oldest", label: "Oldest First" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Design: "bg-info/10 text-info border-info/20",
  Development: "bg-success/10 text-success border-success/20",
  Marketing: "bg-warning/10 text-warning border-warning/20",
  Research: "bg-primary/10 text-primary border-primary/20",
  Personal: "bg-secondary/10 text-secondary border-secondary/20",
};

export default function Library() {
  const { role } = useAuth();
  const { toast } = useToast();
  const isPremium = role === "premium" || role === "premium_gift" || role === "admin";

  const [items, setItems] = useState<LibraryItem[]>(MOCK_ITEMS);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Filtered & sorted items
  const filtered = useMemo(() => {
    let result = [...items];

    // Tab filter
    if (tab === "favorites") result = result.filter((i) => i.isFavorite);

    // Category
    if (category !== "All") result = result.filter((i) => i.category === category);

    // Search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    }

    // Sort
    if (sort === "recent") result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "oldest") result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else if (sort === "alpha") result.sort((a, b) => a.title.localeCompare(b.title));

    return result;
  }, [items, tab, category, debouncedSearch, sort]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const loadMore = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setVisibleCount((c) => c + PAGE_SIZE);
      setLoading(false);
    }, 600);
  }, []);

  const clearFilters = () => {
    setSearch("");
    setCategory("All");
    setSort("recent");
    setTab("all");
  };

  const hasActiveFilters = search || category !== "All" || sort !== "recent" || tab !== "all";

  const toggleFavorite = (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isFavorite: !i.isFavorite } : i)));
  };

  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDeleteId(null);
    toast({ title: "Item deleted", description: "The item has been removed from your library." });
  };

  const duplicateItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const dup: LibraryItem = {
      ...item,
      id: crypto.randomUUID(),
      title: `${item.title} (Copy)`,
      createdAt: new Date().toISOString().split("T")[0],
      isFavorite: false,
    };
    setItems((prev) => [dup, ...prev]);
    toast({ title: "Item duplicated" });
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // Empty state
  const isEmpty = items.length === 0;
  const noResults = !isEmpty && filtered.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">My Library</h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} items total</p>
        </div>
        <Button className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Create New
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" /> All
          </TabsTrigger>
          <TabsTrigger value="recent" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Recent
          </TabsTrigger>
          <TabsTrigger value="favorites" className="gap-1.5">
            <Star className="h-3.5 w-3.5" /> Favorites
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search, Filters, View toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search library…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[140px] h-9">
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground gap-1">
              <X className="h-3 w-3" /> Clear
            </Button>
          )}

          <div className="ml-auto flex items-center rounded-md border bg-background p-0.5">
            <button
              onClick={() => setView("grid")}
              className={`rounded p-1.5 transition-colors ${view === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`rounded p-1.5 transition-colors ${view === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Rocket className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold font-display mb-2">Your library is empty</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Create your first item to start building your personal library.
            </p>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Create Your First Item
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No results */}
      {noResults && (
        <div className="text-center py-16">
          <Search className="h-10 w-10 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold font-display mb-1">No items found</h3>
          <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or filters.</p>
          <Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button>
        </div>
      )}

      {/* Grid / List */}
      {!isEmpty && !noResults && (
        <>
          {view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isPremium={isPremium}
                  formatDate={formatDate}
                  onToggleFavorite={toggleFavorite}
                  onDelete={setDeleteId}
                  onDuplicate={duplicateItem}
                />
              ))}
              {loading && Array.from({ length: 3 }).map((_, i) => <ItemSkeleton key={`skel-${i}`} />)}
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isPremium={isPremium}
                  formatDate={formatDate}
                  onToggleFavorite={toggleFavorite}
                  onDelete={setDeleteId}
                  onDuplicate={duplicateItem}
                />
              ))}
              {loading && Array.from({ length: 3 }).map((_, i) => <RowSkeleton key={`rskel-${i}`} />)}
            </div>
          )}

          {/* Load more */}
          {hasMore && !loading && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore}>Load More</Button>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The item will be permanently removed from your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteItem(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Sub-components ---

interface ItemActionProps {
  item: LibraryItem;
  isPremium: boolean;
  formatDate: (d: string) => string;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

function ItemCard({ item, isPremium, formatDate, onToggleFavorite, onDelete, onDuplicate }: ItemActionProps) {
  const catColor = CATEGORY_COLORS[item.category] || "bg-muted text-muted-foreground";

  return (
    <Card className="group flex flex-col transition-shadow hover:shadow-lg cursor-pointer">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Badge variant="outline" className={`text-[10px] mb-2 ${catColor}`}>{item.category}</Badge>
          <h4 className="text-sm font-semibold font-display leading-snug line-clamp-2">{item.title}</h4>
        </div>
        <ItemMenu item={item} isPremium={isPremium} onToggleFavorite={onToggleFavorite} onDelete={onDelete} onDuplicate={onDuplicate} />
      </CardHeader>
      <CardContent className="pb-3 flex-1">
        <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
      </CardContent>
      <CardFooter className="pt-0 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDate(item.createdAt)}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.id); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Heart className={`h-3.5 w-3.5 ${item.isFavorite ? "fill-destructive text-destructive" : "hover:text-destructive"}`} />
        </button>
      </CardFooter>
    </Card>
  );
}

function ItemRow({ item, isPremium, formatDate, onToggleFavorite, onDelete, onDuplicate }: ItemActionProps) {
  const catColor = CATEGORY_COLORS[item.category] || "bg-muted text-muted-foreground";

  return (
    <div className="group flex items-center gap-4 rounded-lg border bg-card p-3 transition-shadow hover:shadow-md cursor-pointer">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="text-sm font-semibold font-display truncate">{item.title}</h4>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${catColor}`}>{item.category}</Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
      </div>
      <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden sm:block">{formatDate(item.createdAt)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.id); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        <Heart className={`h-3.5 w-3.5 ${item.isFavorite ? "fill-destructive text-destructive" : "text-muted-foreground hover:text-destructive"}`} />
      </button>
      <ItemMenu item={item} isPremium={isPremium} onToggleFavorite={onToggleFavorite} onDelete={onDelete} onDuplicate={onDuplicate} />
    </div>
  );
}

function ItemMenu({ item, isPremium, onToggleFavorite, onDelete, onDuplicate }: Omit<ItemActionProps, "formatDate">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0" onClick={(e) => e.stopPropagation()}>
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem className="gap-2"><Pencil className="h-3.5 w-3.5" /> Edit</DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => onToggleFavorite(item.id)}>
          <Heart className="h-3.5 w-3.5" /> {item.isFavorite ? "Unfavorite" : "Favorite"}
        </DropdownMenuItem>
        {isPremium ? (
          <DropdownMenuItem className="gap-2" onClick={() => onDuplicate(item.id)}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="gap-2 text-muted-foreground" disabled>
            <Copy className="h-3.5 w-3.5" /> Duplicate <Crown className="h-3 w-3 ml-auto" />
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="gap-2"><FolderOpen className="h-3.5 w-3.5" /> Move to Collection</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => onDelete(item.id)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-16 mb-2" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="pb-3"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3 mt-1" /></CardContent>
      <CardFooter className="pt-0"><Skeleton className="h-3 w-20" /></CardFooter>
    </Card>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div>
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
