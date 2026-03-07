import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useAICredits } from "@/hooks/useAICredits";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  Sparkles,
  Activity,
  Shield,
  Plus,
  Import,
  FolderOpen,
  CheckCircle2,
  Circle,
  X,
  Crown,
  Rocket,
  Users,
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
  const { credits, isLoading: creditsLoading } = useAICredits();
  const navigate = useNavigate();
  const isPremium = role === "premium" || role === "premium_gift" || role === "admin";
  const displayName = profile?.display_name || user?.email?.split("@")[0] || "there";
  const roleConfig = ROLE_CONFIG[role || "free"];

  // Checklist state
  const [showChecklist, setShowChecklist] = useState(() => {
    return localStorage.getItem("menerio-checklist-dismissed") !== "true";
  });

  const dismissChecklist = () => {
    localStorage.setItem("menerio-checklist-dismissed", "true");
    setShowChecklist(false);
  };

  const hasProfile = !!(profile?.display_name && profile?.bio);
  const hasAvatar = !!profile?.avatar_url;

  const checklistItems = [
    { label: "Complete your profile", done: hasProfile, action: () => navigate("/dashboard/settings") },
    { label: "Upload an avatar", done: hasAvatar, action: () => navigate("/dashboard/settings") },
    { label: "Create your first item", done: false, action: () => {} },
    { label: "Explore features", done: false, action: () => navigate("/features") },
    ...(isPremium ? [{ label: "Invite team members", done: false, action: () => navigate("/dashboard/team") }] : []),
  ];
  const completedCount = checklistItems.filter((i) => i.done).length;

  // Placeholder data
  const hasItems = false;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">
            Welcome back, {displayName} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening with your workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => {}} className="gap-2">
            <Plus className="h-4 w-4" /> New Item
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-sm font-medium">Total Items</CardDescription>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-display">0</p>
            <p className="text-xs text-muted-foreground mt-1">Create your first item to get started</p>
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
            <CardDescription className="text-sm font-medium">Recent Activity</CardDescription>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-display">0</p>
            <p className="text-xs text-muted-foreground mt-1">No activity yet</p>
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
            {role === "free" && (
              <p className="text-xs text-muted-foreground mt-2">
                Contact an administrator for premium access.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content area — 2 cols */}
        <div className="lg:col-span-2 space-y-6">
          {/* Empty state or Recent Activity */}
          {!hasItems ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Rocket className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold font-display mb-2">Get started with Menerio</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  Create your first item to unlock the full power of AI-driven project management.
                </p>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" /> Create Your First Item
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent Activity</CardTitle>
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  View All <ArrowRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">No recent activity to display.</p>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button variant="outline" className="h-auto flex-col gap-2 py-4">
                  <Plus className="h-5 w-5 text-primary" />
                  <span className="text-sm">Create New Item</span>
                </Button>
                <Button variant="outline" className="h-auto flex-col gap-2 py-4">
                  <Import className="h-5 w-5 text-primary" />
                  <span className="text-sm">Import</span>
                </Button>
                <Button variant="outline" className="h-auto flex-col gap-2 py-4" onClick={() => navigate("/dashboard/library")}>
                  <FolderOpen className="h-5 w-5 text-primary" />
                  <span className="text-sm">View Library</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar — checklist */}
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
                {/* Progress bar */}
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

          {/* Info card for free users */}
          {role === "free" && (
            <Card className="bg-muted/30 border-border">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <h4 className="font-semibold font-display text-sm">Free Plan</h4>
                </div>
                <p className="text-xs text-muted-foreground">
                  Some features require a premium role. Contact an administrator to request access.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Team card for premium */}
          {isPremium && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Team
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">Invite team members to collaborate.</p>
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("/dashboard/team")}>
                  Manage Team
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
