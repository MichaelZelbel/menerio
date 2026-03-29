import { useState } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useNavigate } from "react-router-dom";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useAICredits } from "@/hooks/useAICredits";
import { useNotes } from "@/hooks/useNotes";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { FirstCapturesWizard, useShowFirstCaptures } from "@/components/onboarding/FirstCapturesWizard";
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
} from "lucide-react";

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

  const hasProfile = !!(profile?.display_name && profile?.bio);
  const hasNotes = notes.length > 0;

  const checklistItems = [
    { label: "Complete your profile", done: hasProfile, action: () => navigate("/dashboard/settings") },
    { label: "Create your first note", done: hasNotes, action: () => navigate("/dashboard/notes") },
    { label: "Process a note with AI", done: false, action: () => navigate("/dashboard/notes") },
    { label: "Explore features", done: false, action: () => navigate("/features") },
  ];
  const completedCount = checklistItems.filter((i) => i.done).length;

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
        <Button onClick={() => navigate("/dashboard/notes?action=create")} className="gap-2">
          <Plus className="h-4 w-4" /> New Note
        </Button>
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
                      onClick={() => navigate("/dashboard/notes")}
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
