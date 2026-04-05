import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  ShieldAlert, Bot, BookType, Ban, RefreshCw, Loader2, Play, RotateCcw, Plus, Trash2,
} from "lucide-react";
import { format } from "date-fns";

// ── Shared helpers ──

type ProfileMap = Record<string, string>;

async function fetchProfileNames(userIds: string[]): Promise<ProfileMap> {
  if (userIds.length === 0) return {};
  const unique = [...new Set(userIds)];
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  const map: ProfileMap = {};
  (data || []).forEach((p: any) => { map[p.id] = p.display_name || "Unknown"; });
  return map;
}

function UserName({ userId, profiles }: { userId: string; profiles: ProfileMap }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50">
          {profiles[userId] || userId.slice(0, 8) + "…"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-xs">{userId}</TooltipContent>
    </Tooltip>
  );
}

// ── Tab 1: Moderation Log ──

function ModerationLogTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState("all");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("moderation_events").select("*").order("created_at", { ascending: false }).limit(100);
    if (tierFilter !== "all") query = query.eq("tier", tierFilter);
    const { data } = await query;
    const rows = (data as any[]) || [];
    setEvents(rows);
    const names = await fetchProfileNames(rows.map((e) => e.user_id));
    setProfiles(names);
    setLoading(false);
  }, [tierFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="stopword">Stopword</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchEvents}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              ) : events.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No moderation events yet.</TableCell></TableRow>
              ) : (
                events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm"><UserName userId={e.user_id} profiles={profiles} /></TableCell>
                    <TableCell className="text-sm">{e.action}</TableCell>
                    <TableCell className="text-sm">{e.item_type}</TableCell>
                    <TableCell className="text-sm capitalize">{e.category || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={e.result === "blocked" ? "destructive" : "default"} className={e.result === "cleared" ? "bg-success text-success-foreground" : ""}>
                        {e.result}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{e.tier === "ai" ? "AI" : "Stopword"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(e.created_at), "MMM d, HH:mm")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab 2: AI Review Queue ──

function AIReviewQueueTab() {
  const [items, setItems] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { count }] = await Promise.all([
      supabase.from("moderation_review_queue").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("moderation_review_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const rows = (data as any[]) || [];
    setItems(rows);
    setPendingCount(count || 0);
    const names = await fetchProfileNames(rows.map((r) => r.user_id));
    setProfiles(names);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const processNow = async () => {
    setProcessing(true);
    try {
      const { error } = await supabase.functions.invoke("ai-moderate-content");
      if (error) throw error;
      showToast.success("Queue processed successfully");
      fetchItems();
    } catch {
      showToast.error("Failed to process queue");
    }
    setProcessing(false);
  };

  const reReview = async (id: string) => {
    await supabase.from("moderation_review_queue").update({ status: "pending", retry_count: 0, reviewed_at: null, ai_category: null, ai_confidence: null, ai_reason: null }).eq("id", id);
    showToast.success("Item reset to pending");
    fetchItems();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "pending": return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
      case "reviewed": return "bg-success/10 text-success border-success/30";
      case "violation": return "bg-destructive/10 text-destructive border-destructive/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-sm">{pendingCount} pending</Badge>
        <Button size="sm" onClick={processNow} disabled={processing || pendingCount === 0}>
          {processing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Process Queue Now
        </Button>
        <Button variant="outline" size="sm" onClick={fetchItems}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>AI Category</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>AI Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No items in review queue.</TableCell></TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm"><UserName userId={item.user_id} profiles={profiles} /></TableCell>
                    <TableCell className="text-sm">{item.item_type}</TableCell>
                    <TableCell className="text-sm capitalize">{item.ai_category || "—"}</TableCell>
                    <TableCell className="text-sm">{item.ai_confidence != null ? `${Math.round(item.ai_confidence * 100)}%` : "—"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{item.ai_reason || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(item.status)}>{item.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(item.created_at), "MMM d, HH:mm")}</TableCell>
                    <TableCell>
                      {item.status !== "pending" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Re-review" onClick={() => reReview(item.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab 3: Stopwords ──

function StopwordsTab() {
  const [words, setWords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [bulkText, setBulkText] = useState("");
  const [bulkCategory, setBulkCategory] = useState("general");
  const [adding, setAdding] = useState(false);

  const fetchWords = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("moderation_stopwords").select("*").order("category").order("word");
    setWords((data as any[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchWords(); }, [fetchWords]);

  const addWord = async () => {
    if (!newWord.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("moderation_stopwords").insert({ word: newWord.trim().toLowerCase(), category: newCategory, severity: "block" });
    if (error) {
      showToast.error(error.message.includes("duplicate") ? "Word already exists" : "Failed to add stopword");
    } else {
      showToast.success("Stopword added");
      setNewWord("");
      fetchWords();
    }
    setAdding(false);
  };

  const bulkImport = async () => {
    const lines = bulkText.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (lines.length === 0) return;
    setAdding(true);
    const rows = lines.map((word) => ({ word, category: bulkCategory, severity: "block" }));
    const { error } = await supabase.from("moderation_stopwords").insert(rows);
    if (error) {
      showToast.error("Some words may already exist");
    } else {
      showToast.success(`${lines.length} stopwords imported`);
      setBulkText("");
      fetchWords();
    }
    setAdding(false);
  };

  const deleteWord = async (id: string) => {
    await supabase.from("moderation_stopwords").delete().eq("id", id);
    showToast.deleted();
    fetchWords();
  };

  const categories = ["general", "sexual", "hate", "malware", "spam"];
  const categoryColor = (c: string) => {
    switch (c) {
      case "sexual": return "bg-pink-500/10 text-pink-700 dark:text-pink-400";
      case "hate": return "bg-destructive/10 text-destructive";
      case "malware": return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
      case "spam": return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Add single */}
      <Card>
        <CardHeader><CardTitle className="text-base">Add Stopword</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Word / Phrase</Label>
              <Input value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="e.g. badword" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={addWord} disabled={adding || !newWord.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Add</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk import */}
      <Card>
        <CardHeader><CardTitle className="text-base">Bulk Import</CardTitle><CardDescription>One word per line</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={4} placeholder={"word1\nword2\nword3"} />
          <div className="flex items-center gap-3">
            <Select value={bulkCategory} onValueChange={setBulkCategory}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={bulkImport} disabled={adding || !bulkText.trim()}>Import</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">All Stopwords ({words.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Word</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 4 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              ) : words.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No stopwords configured.</TableCell></TableRow>
              ) : (
                words.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm font-mono">{w.word}</TableCell>
                    <TableCell><Badge variant="outline" className={`capitalize ${categoryColor(w.category)}`}>{w.category}</Badge></TableCell>
                    <TableCell className="text-sm capitalize">{w.severity}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteWord(w.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab 4: Suspensions ──

function SuspensionsTab() {
  const [suspensions, setSuspensions] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);

  const fetchSuspensions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("user_suspensions").select("*").gt("strike_count", 0).order("strike_count", { ascending: false });
    const rows = (data as any[]) || [];
    setSuspensions(rows);
    const names = await fetchProfileNames(rows.map((s) => s.user_id));
    setProfiles(names);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSuspensions(); }, [fetchSuspensions]);

  const unsuspend = async (id: string) => {
    await supabase.from("user_suspensions").update({ suspended: false, suspended_at: null, suspended_until: null, suspension_reason: null }).eq("id", id);
    showToast.success("User unsuspended");
    fetchSuspensions();
  };

  const resetStrikes = async (id: string) => {
    await supabase.from("user_suspensions").update({ strike_count: 0, suspended: false, suspended_at: null, suspended_until: null, suspension_reason: null }).eq("id", id);
    showToast.success("Strikes reset to 0");
    fetchSuspensions();
  };

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={fetchSuspensions}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Strikes</TableHead>
                <TableHead>Suspended</TableHead>
                <TableHead>Suspended At</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              ) : suspensions.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No users with strikes.</TableCell></TableRow>
              ) : (
                suspensions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm"><UserName userId={s.user_id} profiles={profiles} /></TableCell>
                    <TableCell>
                      <Badge variant={s.strike_count >= 5 ? "destructive" : "outline"}>{s.strike_count}</Badge>
                    </TableCell>
                    <TableCell>
                      {s.suspended
                        ? <Badge variant="destructive">Suspended</Badge>
                        : <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.suspended_at ? format(new Date(s.suspended_at), "MMM d, yyyy HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{s.suspension_reason || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {s.suspended && (
                          <Button variant="outline" size="sm" onClick={() => unsuspend(s.id)}>Unsuspend</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => resetStrikes(s.id)}>Reset Strikes</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Moderation Panel ──

export default function ModerationPanel() {
  return (
    <Tabs defaultValue="log" className="space-y-6">
      <TabsList className="flex-wrap">
        <TabsTrigger value="log" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Moderation Log</TabsTrigger>
        <TabsTrigger value="queue" className="gap-1.5"><Bot className="h-3.5 w-3.5" /> AI Review Queue</TabsTrigger>
        <TabsTrigger value="stopwords" className="gap-1.5"><BookType className="h-3.5 w-3.5" /> Stopwords</TabsTrigger>
        <TabsTrigger value="suspensions" className="gap-1.5"><Ban className="h-3.5 w-3.5" /> Suspensions</TabsTrigger>
      </TabsList>

      <TabsContent value="log"><ModerationLogTab /></TabsContent>
      <TabsContent value="queue"><AIReviewQueueTab /></TabsContent>
      <TabsContent value="stopwords"><StopwordsTab /></TabsContent>
      <TabsContent value="suspensions"><SuspensionsTab /></TabsContent>
    </Tabs>
  );
}
