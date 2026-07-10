import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles, Brain, Shield, Crown } from "lucide-react";
import type { AppRole } from "@/contexts/AuthContext";

const ROLE_CONFIG: Record<AppRole, { label: string; color: "secondary" | "success" | "info" | "warning" }> = {
  free: { label: "Free", color: "secondary" },
  premium: { label: "Premium", color: "success" },
  premium_gift: { label: "Premium Gift", color: "info" },
  admin: { label: "Admin", color: "warning" },
};

interface NotesStatsRowProps {
  notesCount: number;
  aiProcessedCount: number;
  credits: { remainingCredits: number; creditsGranted: number } | null | undefined;
  creditsLoading: boolean;
  role: AppRole | null;
}

export function NotesStatsRow({ notesCount, aiProcessedCount, credits, creditsLoading, role }: NotesStatsRowProps) {
  const roleConfig = ROLE_CONFIG[role || "free"];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardDescription className="text-sm font-medium">Total Notes</CardDescription>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold font-display">{notesCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {notesCount === 0 ? "Create your first note" : "in your brain"}
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
          <p className="text-3xl font-bold font-display">{aiProcessedCount}</p>
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
  );
}
