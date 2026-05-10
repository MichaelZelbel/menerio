import { useState } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useAICredits } from "@/hooks/useAICredits";
import { useNotes } from "@/hooks/useNotes";
import { useProfileSummary } from "@/hooks/useProfileSummary";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { FirstCapturesWizard, useShowFirstCaptures } from "@/components/onboarding/FirstCapturesWizard";
import { TodaysConnections } from "@/components/dashboard/TodaysConnections";
import { DiscoveryFeed } from "@/components/dashboard/DiscoveryFeed";
import { OrphanNotesDetector } from "@/components/graph/OrphanNotesDetector";
import { BridgeNotesHighlighter } from "@/components/graph/GraphAnalytics";
import { CaptureEmptyState } from "@/components/notes/CaptureEmptyState";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Sparkles,
  Activity,
  Shield,
  Plus,
  Brain,
  CheckCircle2,
  Circle,
  X,
  Crown,
  ArrowRight,
  User,
  Users2,
} from "lucide-react";

type GroupPulseItem = { id: string; name: string; slug: string; icon: string | null; memberCount: number; staleCount: number; dueThisWeek: number; lastActivity: number };

const ROLE_CONFIG: Record<AppRole, { label: string; color: "secondary" | "success" | "info" | "warning" }> = {
  free: { label: "Free", color: "secondary" },
  premium: { label: "Premium", color: "success" },
  premium_gift: { label: "Premium Gift", color: "info" },
  admin: { label: "Admin", color: "warning" },
};

const Dashboard = () => {
  const { profile, role, user } = useAuth();
  const firstCaptures = useShowFirstCaptures();
  const { credits, isLoading: creditsLoading } = useAICredits();
  const { data: notes = [] } = useNotes("all");
  const profileSummary = useProfileSummary();
  const navigate = useNavigate();
  const displayName = profile?.display_name || user?.email?.split("@")[0] || "there";
  const roleConfig = ROLE_CONFIG[role || "free"];

  const [showChecklist, setShowChecklist] = useState(() => {
    return localStorage.getItem("menerio-checklist-dismissed") !== "true";
  });

  const dismissChecklist = () => {
    localStorage.setItem("menerio-checklist-dismissed", "true");
    setShowChecklist(false);
  };

  const hasProfile = !!profile?.display_name;
  const hasNotes = notes.length > 0;

  const checklistItems = [
    { label: "Complete your profile", done: hasProfile, action: () => navigate("/dashboard/settings") },
    { label: "Create your first note", done: hasNotes, action: () => navigate("/dashboard/notes") },
    { label: "Process a note with AI", done: false, action: () => navigate("/dashboard/notes") },
    { label: "Explore features", done: false, action: () => navigate("/features") },
  ];
  const completedCount = checklistItems.filter((i) => i.done).length;
  const { data: groupPulse = [] } = useQuery<GroupPulseItem[]>({
    queryKey: ["group-pulse", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: groups, error: groupError } = await supabase.from("contact_groups").select("id, name, slug, icon, updated_at").eq("user_id", user!.id).eq("is_trashed", false).is("archived_at", null);
      if (groupError) throw groupError;
      const groupIds = (groups || []).map((group) => group.id);
      if (groupIds.length === 0) return [];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const [{ data: memberships, error: membershipError }, { data: actions, error: actionError }] = await Promise.all([
        supabase.from("contact_group_memberships").select("group_id, last_movement_at").in("group_id", groupIds).is("archived_at", null),
        supabase.from("action_items").select("due_date, status, metadata").eq("user_id", user!.id).neq("status", "done").lte("due_date", weekEnd.toISOString().slice(0, 10)),
      ]);
      if (membershipError) throw membershipError;
      if (actionError) throw actionError;
      const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return (groups || []).map((group) => {
        const groupMemberships = (memberships || []).filter((membership) => membership.group_id === group.id);
        const groupActions = ((actions || []) as any[]).filter((action) => action.metadata?.group_id === group.id);
        const lastMovement = Math.max(new Date(group.updated_at).getTime(), ...groupMemberships.map((membership) => new Date(membership.last_movement_at).getTime()));
        return { id: group.id, name: group.name, slug: group.slug, icon: group.icon, memberCount: groupMemberships.length, staleCount: groupMemberships.filter((membership) => new Date(membership.last_movement_at).getTime() < staleCutoff).length, dueThisWeek: groupActions.length, lastActivity: lastMovement };
      }).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 3);
    },
  });

  return (
    <div className="space-y-6">
      <SEOHead title="Dashboard — Menerio" noIndex />
      {/* Welcome */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">
            Welcome back, {displayName} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your personal knowledge system at a glance.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-sm font-medium">Total Notes</CardDescription>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-display">{notes.length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {notes.length === 0 ? "Create your first note" : "in your brain"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-sm font-medium">AI Credits</CardDescription>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-display">
              {creditsLoading ? "…" : credits ? credits.remainingCredits : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {credits ? `of ${credits.creditsGranted} this period` : "No allowance yet"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-sm font-medium">AI-Processed</CardDescription>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-display">
              {notes.filter((n) => n.metadata && Object.keys(n.metadata).length > 0).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">notes with embeddings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-sm font-medium">Your Role</CardDescription>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={roleConfig.color} className="text-sm px-3 py-1">
              {role === "admin" && <Shield className="h-3 w-3 mr-1" />}
              {(role === "premium" || role === "premium_gift") && <Crown className="h-3 w-3 mr-1" />}
              {roleConfig.label}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Quick start */}
          {!hasNotes && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Brain className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold font-display mb-2">Start building your brain</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  Create your first note and let AI embed and classify it automatically.
                </p>
                <Button onClick={() => navigate("/dashboard/notes")} className="gap-2">
                  <Plus className="h-4 w-4" /> Create Your First Note
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Recent notes */}
          {hasNotes && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent Notes</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/notes")} className="gap-1 text-xs">
                  View All <ArrowRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {notes.slice(0, 5).map((note) => (
                    <button
                      key={note.id}
                      onClick={() => navigate(`/dashboard/notes/${note.id}`)}
                      className="w-full text-left flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">{note.title || "Untitled"}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(note.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <ActivityFeed limit={5} showViewAll />
        </div>

        {/* Right sidebar continued - First Captures */}
        {firstCaptures.show && (
          <div className="lg:col-span-3">
            <FirstCapturesWizard onComplete={firstCaptures.dismiss} />
          </div>
        )}

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Profile widget */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-sm font-medium">Profile</CardDescription>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {/* Mini progress ring */}
                <div className="relative shrink-0" style={{ width: 48, height: 48 }}>
                  <svg width="48" height="48" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="21" fill="none" stroke="hsl(var(--muted))" strokeWidth={3} />
                    <circle
                      cx="24" cy="24" r="21" fill="none"
                      stroke="hsl(var(--primary))" strokeWidth={3}
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 21}
                      strokeDashoffset={2 * Math.PI * 21 - (profileSummary.completeness / 100) * 2 * Math.PI * 21}
                      transform="rotate(-90 24 24)"
                      className="transition-all duration-700"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                    {profileSummary.completeness}%
                  </span>
                </div>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium">{profileSummary.entryCount} entries</p>
                  <p className="text-xs text-muted-foreground">{profileSummary.activeInstructions} agent instructions</p>
                </div>
              </div>
              {profileSummary.completeness < 50 && (
                <p className="text-xs text-muted-foreground mt-2">A richer profile means better AI interactions</p>
              )}
              <Button variant="ghost" size="sm" className="mt-2 w-full gap-1 text-xs" onClick={() => navigate("/dashboard/profile")}>
                View profile <ArrowRight className="h-3 w-3" />
              </Button>
            </CardContent>
          </Card>

          <TodaysConnections />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Group Pulse</CardTitle>
              <Users2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              {groupPulse.length === 0 ? (
                <button onClick={() => navigate("/dashboard/groups")} className="w-full rounded-md px-2 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent">
                  No active groups yet — start one from the Groups page.
                </button>
              ) : groupPulse.map((group) => (
                <button key={group.id} onClick={() => navigate(`/dashboard/groups/${group.slug}`)} className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">{group.icon || <Users2 className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-1 pl-9 text-xs text-muted-foreground">{group.memberCount} members · {group.staleCount} stale members · {group.dueThisWeek} action items due this week</p>
                </button>
              ))}
            </CardContent>
          </Card>
          <DiscoveryFeed />
          <OrphanNotesDetector compact />
          <BridgeNotesHighlighter compact />
          {showChecklist && (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between pb-3">
                <div>
                  <CardTitle className="text-base">Getting Started</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {completedCount}/{checklistItems.length} completed
                  </CardDescription>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1" onClick={dismissChecklist}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="mb-4 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${(completedCount / checklistItems.length) * 100}%` }}
                  />
                </div>
                <ul className="space-y-2">
                  {checklistItems.map((item) => (
                    <li key={item.label}>
                      <button
                        onClick={item.action}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent text-left"
                      >
                        {item.done ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>
                          {item.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
