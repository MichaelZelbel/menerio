import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  BarChart3,
  Users,
  Crown,
  Sparkles,
  Search,
  X,
  Pencil,
  Trash2,
  Shield,
  Settings,
  TrendingUp,
  Save,
  Loader2,
  Coins,
  ToggleLeft,
  RefreshCw,
  Wrench,
} from "lucide-react";

type AppRole = "free" | "premium" | "premium_gift" | "admin";

const ROLE_COLORS: Record<AppRole, string> = {
  free: "secondary",
  premium: "success",
  premium_gift: "info",
  admin: "warning",
};

interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  email?: string;
  role?: AppRole;
}

interface CreditSetting {
  key: string;
  value_int: number;
  description: string | null;
}

interface TokenModalData {
  userId: string;
  userName: string;
  periodId: string | null;
  tokensGranted: number;
  tokensUsed: number;
  tokensPerCredit: number;
}

const PAGE_SIZE = 10;

export default function Admin() {
  const { session } = useAuth();
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10">
          <Shield className="h-5 w-5 text-warning" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage users, roles, and system settings.</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
          <TabsTrigger value="credits" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> AI Credits</TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> System</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="credits">
          <CreditsSettingsTab />
        </TabsContent>
        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview Tab ───

function OverviewTab() {
  const [stats, setStats] = useState<{
    totalUsers: number;
    premiumUsers: number;
    newThisWeek: number;
    totalTokensUsed: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [profilesRes, rolesRes, weekRes, tokensRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("user_roles").select("id", { count: "exact", head: true }).in("role", ["premium", "premium_gift", "admin"]),
        supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("llm_usage_events" as any).select("total_tokens"),
      ]);

      const totalTokens = (tokensRes.data as any[] || []).reduce((sum: number, e: any) => sum + Number(e.total_tokens || 0), 0);

      setStats({
        totalUsers: profilesRes.count || 0,
        premiumUsers: rolesRes.count || 0,
        newThisWeek: weekRes.count || 0,
        totalTokensUsed: totalTokens,
      });
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const cards = [
    { label: "Total Users", value: stats!.totalUsers, icon: Users, sub: "All registered accounts" },
    { label: "Premium Users", value: stats!.premiumUsers, icon: Crown, sub: "Premium, gift & admin" },
    { label: "New This Week", value: stats!.newThisWeek, icon: TrendingUp, sub: "Last 7 days" },
    { label: "Total Tokens Used", value: stats!.totalTokensUsed.toLocaleString(), icon: Sparkles, sub: "All-time usage" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-sm font-medium">{c.label}</CardDescription>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold font-display">{c.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Charts</CardTitle>
          <CardDescription>Detailed analytics coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-48 rounded-lg border border-dashed text-muted-foreground text-sm">
            Charts placeholder — integrate with Recharts
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Users Tab ───

function UsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Record<string, AppRole>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Role change
  const [roleChangeUser, setRoleChangeUser] = useState<{ id: string; name: string; current: AppRole } | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("free");
  const [roleLoading, setRoleLoading] = useState(false);

  // Token modal
  const [tokenModal, setTokenModal] = useState<TokenModalData | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);

    // Fetch profiles
    let query = supabase.from("profiles").select("id, display_name, avatar_url, bio, created_at", { count: "exact" });

    if (search) {
      query = query.ilike("display_name", `%${search}%`);
    }

    query = query.order("created_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) { setLoading(false); return; }

    // Fetch all roles
    const { data: roleData } = await supabase.from("user_roles").select("user_id, role");
    const roleMap: Record<string, AppRole> = {};
    (roleData || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    setRoles(roleMap);

    let filtered = data || [];
    if (roleFilter !== "all") {
      const idsWithRole = Object.entries(roleMap).filter(([, r]) => r === roleFilter).map(([id]) => id);
      filtered = filtered.filter((u) => idsWithRole.includes(u.id));
    }

    setUsers(filtered);
    setTotal(roleFilter === "all" ? (count || 0) : filtered.length);
    setLoading(false);
  }, [search, roleFilter, page]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRoleChange = async () => {
    if (!roleChangeUser) return;
    setRoleLoading(true);
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", roleChangeUser.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Role updated", description: `${roleChangeUser.name}'s role changed to ${newRole}.` });
      setRoles((prev) => ({ ...prev, [roleChangeUser.id]: newRole }));
    }
    setRoleLoading(false);
    setRoleChangeUser(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    // Use the delete-my-account edge function with admin override or direct deletion
    const { error } = await supabase.from("profiles").delete().eq("id", deleteId);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "User deleted" });
      fetchUsers();
    }
    setDeleteLoading(false);
    setDeleteId(null);
  };

  const openTokenModal = async (userId: string, userName: string) => {
    // Fetch current allowance
    const { data } = await supabase
      .from("v_ai_allowance_current" as any)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // Get tokens_per_credit
    const { data: settingsData } = await supabase
      .from("ai_credit_settings" as any)
      .select("value_int")
      .eq("key", "tokens_per_credit")
      .single();

    const tpc = (settingsData as any)?.value_int || 200;

    setTokenModal({
      userId,
      userName,
      periodId: data ? (data as any).id : null,
      tokensGranted: data ? Number((data as any).tokens_granted) : 0,
      tokensUsed: data ? Number((data as any).tokens_used) : 0,
      tokensPerCredit: tpc,
    });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getInitials = (name: string | null) =>
    (name || "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
            <SelectItem value="premium_gift">Gift</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-8 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No users found.</TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const userRole = roles[u.id] || "free";
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {u.avatar_url && <AvatarImage src={supabase.storage.from("avatars").getPublicUrl(u.avatar_url).data.publicUrl} />}
                            <AvatarFallback className="text-xs bg-muted">{getInitials(u.display_name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{u.display_name || "Unnamed"}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.id.slice(0, 8)}…</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ROLE_COLORS[userRole] as any} className="text-[10px]">{userRole}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Change role" onClick={() => { setRoleChangeUser({ id: u.id, name: u.display_name || "User", current: userRole }); setNewRole(userRole); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Manage credits" onClick={() => openTokenModal(u.id, u.display_name || "User")}>
                            <Coins className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete user" onClick={() => setDeleteId(u.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{total} users total</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Role Change Dialog */}
      <Dialog open={!!roleChangeUser} onOpenChange={() => setRoleChangeUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>Update the role for {roleChangeUser?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>New Role</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="premium_gift">Premium Gift</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleChangeUser(null)}>Cancel</Button>
            <Button onClick={handleRoleChange} disabled={roleLoading}>
              {roleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this user's profile. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Token Modal */}
      {tokenModal && (
        <TokenModal data={tokenModal} onClose={() => setTokenModal(null)} onSaved={() => { setTokenModal(null); fetchUsers(); }} />
      )}
    </div>
  );
}

// ─── Token Modal ───

function TokenModal({ data, onClose, onSaved }: { data: TokenModalData; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [granted, setGranted] = useState(data.tokensGranted);
  const [used, setUsed] = useState(data.tokensUsed);
  const [saving, setSaving] = useState(false);
  const tpc = data.tokensPerCredit;

  const remaining = granted - used;
  const creditsGranted = tpc > 0 ? Math.floor(granted / tpc) : 0;
  const creditsUsed = tpc > 0 ? Math.floor(used / tpc) : 0;
  const creditsRemaining = tpc > 0 ? Math.floor(remaining / tpc) : 0;

  const handleSave = async () => {
    if (!data.periodId) {
      toast({ variant: "destructive", title: "No active period", description: "Ensure a token allowance period exists first." });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("ai_allowance_periods" as any)
      .update({ tokens_granted: granted, tokens_used: used })
      .eq("id", data.periodId);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Credits updated", description: `Updated tokens for ${data.userName}.` });
      onSaved();
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage AI Credits</DialogTitle>
          <DialogDescription>Adjust token allowance for {data.userName}.</DialogDescription>
        </DialogHeader>

        {!data.periodId ? (
          <p className="text-sm text-muted-foreground py-4">No active allowance period found. Use "Ensure Token Allowance" to provision one first.</p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tokens Granted</Label>
                <Input type="number" value={granted} onChange={(e) => setGranted(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>Tokens Used</Label>
                <Input type="number" value={used} onChange={(e) => setUsed(Number(e.target.value))} />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Credits Granted</p>
                <p className="text-lg font-bold font-display">{creditsGranted}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Credits Used</p>
                <p className="text-lg font-bold font-display">{creditsUsed}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="text-lg font-bold font-display">{creditsRemaining}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">1 credit = {tpc} tokens</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {data.periodId && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Credit Settings Tab ───

function CreditsSettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<CreditSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ai_credit_settings" as any).select("*");
      setSettings((data as any[] || []).map((d: any) => ({ key: d.key, value_int: d.value_int, description: d.description })));
      setLoading(false);
    })();
  }, []);

  const updateValue = (key: string, value: number) => {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value_int: value } : s)));
  };

  const handleSave = async () => {
    setSaving(true);
    for (const s of settings) {
      const { error } = await supabase
        .from("ai_credit_settings" as any)
        .update({ value_int: s.value_int })
        .eq("key", s.key);
      if (error) {
        toast({ variant: "destructive", title: "Error", description: `Failed to update ${s.key}: ${error.message}` });
        setSaving(false);
        return;
      }
    }
    toast({ title: "Settings saved" });
    setSaving(false);
  };

  const SETTING_LABELS: Record<string, string> = {
    tokens_per_credit: "Tokens per Credit",
    credits_free_per_month: "Free Tier Monthly Credits",
    credits_premium_per_month: "Premium Monthly Credits",
  };

  return (
    <div className="space-y-6">
      {loading ? (
        <Card><CardContent className="pt-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>AI Credit Settings</CardTitle>
            <CardDescription>Configure token-to-credit ratios and monthly allocations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings.map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex-1 min-w-0">
                  <Label className="text-sm font-medium">{SETTING_LABELS[s.key] || s.key}</Label>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                </div>
                <Input
                  type="number"
                  value={s.value_int}
                  onChange={(e) => updateValue(s.key, Number(e.target.value))}
                  className="w-full sm:w-32"
                />
              </div>
            ))}
            <Separator />
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save Settings
            </Button>
          </CardContent>
        </Card>
      )}

      <UsageLogTable />
    </div>
  );
}

// ─── LLM Usage Log Table ───

const USAGE_PAGE_SIZE = 20;

interface UsageEvent {
  id: string;
  created_at: string;
  user_id: string;
  feature: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  metadata: any;
}

function UsageLogTable() {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("all");
  const [distinctModels, setDistinctModels] = useState<string[]>([]);

  // Fetch distinct models once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("llm_usage_events" as any)
        .select("model")
        .not("model", "is", null);
      if (data) {
        const unique = [...new Set((data as any[]).map((d: any) => d.model as string).filter(Boolean))].sort();
        setDistinctModels(unique);
      }
    })();
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);

    // If user search, find matching profile IDs first
    let matchedUserIds: string[] | null = null;
    if (userSearch.trim()) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id")
        .ilike("display_name", `%${userSearch.trim()}%`);
      matchedUserIds = (profileData || []).map((p: any) => p.id);
      if (matchedUserIds.length === 0) {
        setEvents([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from("llm_usage_events" as any)
      .select("id, created_at, user_id, feature, model, prompt_tokens, completion_tokens, total_tokens, metadata", { count: "exact" });

    if (modelFilter !== "all") {
      query = query.eq("model", modelFilter);
    }
    if (matchedUserIds) {
      query = query.in("user_id", matchedUserIds);
    }

    query = query.order("created_at", { ascending: false }).range(page * USAGE_PAGE_SIZE, (page + 1) * USAGE_PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) {
      setLoading(false);
      return;
    }

    const rows = (data as any[] || []) as UsageEvent[];
    setEvents(rows);
    setTotal(count || 0);

    // Fetch display names for user IDs on this page
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    if (userIds.length > 0) {
      const { data: pData } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      const map: Record<string, string> = {};
      (pData || []).forEach((p: any) => { map[p.id] = p.display_name || p.id.slice(0, 8); });
      setProfiles((prev) => ({ ...prev, ...map }));
    }

    setLoading(false);
  }, [page, modelFilter, userSearch]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const totalPages = Math.ceil(total / USAGE_PAGE_SIZE);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const getUsageSource = (metadata: any): string => {
    if (!metadata) return "unknown";
    return metadata.usage_source || "unknown";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM Usage Log</CardTitle>
        <CardDescription>All LLM calls across all users.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by user name…"
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
            {userSearch && (
              <button onClick={() => { setUserSearch(""); setPage(0); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={modelFilter} onValueChange={(v) => { setModelFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="All Models" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {distinctModels.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Prompt</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No usage events found.</TableCell>
                </TableRow>
              ) : (
                events.map((e) => {
                  const source = getUsageSource(e.metadata);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(e.created_at)}</TableCell>
                      <TableCell className="text-sm">{profiles[e.user_id] || e.user_id.slice(0, 8) + "…"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{e.feature}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{e.model || "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{Number(e.prompt_tokens).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{Number(e.completion_tokens).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">{Number(e.total_tokens).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={source === "provider" ? "success" : source === "fallback" ? "warning" : "secondary"} className="text-[10px]">
                          {source}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{total} events total · Page {page + 1} of {totalPages}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── System Tab (Placeholder) ───

function SystemTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Toggle features on or off for all users.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32 rounded-lg border border-dashed text-muted-foreground text-sm">
            <ToggleLeft className="h-5 w-5 mr-2" /> Feature flags — coming soon
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
          <CardDescription>System maintenance actions.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="outline" className="gap-2" disabled>
            <Wrench className="h-4 w-4" /> Maintenance Mode
          </Button>
          <Button variant="outline" className="gap-2" disabled>
            <RefreshCw className="h-4 w-4" /> Clear Cache
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
