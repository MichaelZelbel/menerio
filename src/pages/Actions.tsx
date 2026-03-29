import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ArrowUpCircle,
  GripVertical,
  FileText,
  User,
  Filter,
} from "lucide-react";

interface ActionItem {
  id: string;
  user_id: string;
  content: string;
  source_note_id: string | null;
  contact_id: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

const STATUS_COLS = [
  { key: "open", label: "Open", icon: Circle, color: "text-blue-500" },
  { key: "in_progress", label: "In Progress", icon: Clock, color: "text-yellow-500" },
  { key: "done", label: "Done", icon: CheckCircle2, color: "text-green-500" },
] as const;

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const priorityIcon: Record<string, { color: string; label: string }> = {
  low: { color: "text-muted-foreground", label: "Low" },
  normal: { color: "text-foreground", label: "Normal" },
  high: { color: "text-warning", label: "High" },
  urgent: { color: "text-destructive", label: "Urgent" },
};

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function Actions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [filterPriority, setFilterPriority] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);

  // Form
  const [form, setForm] = useState({ content: "", priority: "normal", due_date: "" });

  const { data: items = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["action_items", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items" as any)
        .select("*")
        .eq("user_id", user!.id)
        .neq("status", "dismissed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ActionItem[]) || [];
    },
  });

  // Contacts for display
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts_map", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts" as any)
        .select("id, name")
        .eq("user_id", user!.id);
      return (data as any[]) || [];
    },
  });

  // Notes for display
  const { data: notes = [] } = useQuery({
    queryKey: ["notes_map", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user!.id)
        .eq("is_trashed", false);
      return data || [];
    },
  });

  const contactName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      return (contacts.find((c: any) => c.id === id) as any)?.name || null;
    },
    [contacts]
  );

  const noteTitle = useCallback(
    (id: string | null) => {
      if (!id) return null;
      return notes.find((n) => n.id === id)?.title || null;
    },
    [notes]
  );

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === "done") update.completed_at = new Date().toISOString();
      else update.completed_at = null;
      const { error } = await supabase.from("action_items" as any).update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["action_items"] }),
  });

  const createItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("action_items" as any).insert({
        user_id: user!.id,
        content: form.content.trim(),
        priority: form.priority,
        due_date: form.due_date || null,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action_items"] });
      setCreateOpen(false);
      setForm({ content: "", priority: "normal", due_date: "" });
      showToast.success("Action item created");
    },
    onError: (e: any) => showToast.error(e.message),
  });

  const dismissItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("action_items" as any).update({ status: "dismissed" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action_items"] });
      showToast.success("Dismissed");
    },
  });

  // Filter items
  const filtered = items.filter((i) => {
    if (filterPriority !== "all" && i.priority !== filterPriority) return false;
    if (searchQuery && !i.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const byStatus = (status: string) => filtered.filter((i) => i.status === status);

  // Stale items: open > 14 days, no status change
  const staleItems = items.filter(
    (i) => i.status === "open" && daysSince(i.updated_at) > 14
  );

  // Drag handlers
  const handleDragStart = (id: string) => setDragItem(id);
  const handleDragEnd = () => setDragItem(null);
  const handleDrop = (status: string) => {
    if (dragItem) {
      updateStatus.mutate({ id: dragItem, status });
      setDragItem(null);
    }
  };

  return (
    <div className="max-w-5xl">
      <SEOHead title="Actions — Menerio" noIndex />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold">Actions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.filter((i) => i.status !== "done").length} open · {items.filter((i) => i.status === "done").length} done
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-1" /> Filters
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Action</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Action Item</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>What needs to be done?</Label>
                  <Input
                    value={form.content}
                    onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                    placeholder="Follow up with Sarah about the proposal"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      type="date"
                      value={form.due_date}
                      onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createItem.mutate()} disabled={!form.content.trim() || createItem.isPending}>
                  {createItem.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Input
              placeholder="Search actions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Stale items warning */}
      {staleItems.length > 0 && (
        <Card className="mb-6 border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {staleItems.length} stale item{staleItems.length > 1 ? "s" : ""} — open for 14+ days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {staleItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1">{item.content}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-xs text-destructive">{daysSince(item.created_at)}d old</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => updateStatus.mutate({ id: item.id, status: "in_progress" })}>
                      Start
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => dismissItem.mutate(item.id)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STATUS_COLS.map((col) => {
            const colItems = byStatus(col.key);
            return (
              <div
                key={col.key}
                className="rounded-xl border bg-muted/30 p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(col.key)}
              >
                <div className="flex items-center gap-2 mb-3 px-1">
                  <col.icon className={`h-4 w-4 ${col.color}`} />
                  <span className="text-sm font-medium">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">{colItems.length}</Badge>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colItems.map((item) => {
                    const pInfo = priorityIcon[item.priority] || priorityIcon.normal;
                    const cName = contactName(item.contact_id);
                    const nTitle = noteTitle(item.source_note_id);
                    const isOverdue = item.due_date && new Date(item.due_date) < new Date() && item.status !== "done";

                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => handleDragStart(item.id)}
                        onDragEnd={handleDragEnd}
                        className={`rounded-lg border bg-background p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-sm ${
                          dragItem === item.id ? "opacity-50" : ""
                        } ${isOverdue ? "border-destructive/40" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-snug">{item.content}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <Badge variant="outline" className={`text-[10px] ${pInfo.color}`}>
                                {pInfo.label}
                              </Badge>
                              {item.due_date && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${isOverdue ? "text-destructive border-destructive/30" : ""}`}
                                >
                                  {new Date(item.due_date).toLocaleDateString()}
                                </Badge>
                              )}
                              {cName && (
                                <Badge variant="secondary" className="text-[10px] gap-0.5">
                                  <User className="h-2.5 w-2.5" /> {cName}
                                </Badge>
                              )}
                              {nTitle && (
                                <Badge variant="secondary" className="text-[10px] gap-0.5 max-w-[120px] truncate">
                                  <FileText className="h-2.5 w-2.5 shrink-0" /> {nTitle}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Quick status buttons */}
                        <div className="flex items-center gap-1 mt-2 ml-6">
                          {col.key !== "done" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] text-green-600 hover:text-green-700"
                              onClick={() => updateStatus.mutate({ id: item.id, status: "done" })}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> Done
                            </Button>
                          )}
                          {col.key === "open" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px]"
                              onClick={() => updateStatus.mutate({ id: item.id, status: "in_progress" })}
                            >
                              <ArrowUpCircle className="h-3 w-3 mr-0.5" /> Start
                            </Button>
                          )}
                          {col.key === "done" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px]"
                              onClick={() => updateStatus.mutate({ id: item.id, status: "open" })}
                            >
                              <Circle className="h-3 w-3 mr-0.5" /> Reopen
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {colItems.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      {col.key === "done" ? "Nothing completed yet" : "No items"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
