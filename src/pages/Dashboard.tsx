import { SEOHead } from "@/components/SEOHead";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAICredits } from "@/hooks/useAICredits";
import { useNotes } from "@/hooks/useNotes";
import { BRAND } from "@/lib/brand";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { FirstCapturesWizard, useShowFirstCaptures } from "@/components/onboarding/FirstCapturesWizard";
import { TodaysConnections } from "@/components/dashboard/TodaysConnections";
import { DiscoveryFeed } from "@/components/dashboard/DiscoveryFeed";
import { OrphanNotesDetector } from "@/components/graph/OrphanNotesDetector";
import { BridgeNotesHighlighter } from "@/components/graph/GraphAnalytics";
import { CaptureEmptyState } from "@/components/notes/CaptureEmptyState";
import { NotesStatsRow } from "@/components/dashboard/widgets/NotesStatsRow";
import { RecentNotesCard } from "@/components/dashboard/widgets/RecentNotesCard";
import { ProfileWidget } from "@/components/dashboard/widgets/ProfileWidget";
import { GroupPulseCard } from "@/components/dashboard/widgets/GroupPulseCard";
import { GettingStartedChecklist } from "@/components/dashboard/widgets/GettingStartedChecklist";
import { Card, CardContent } from "@/components/ui/card";

const Dashboard = () => {
  const { profile, role, user } = useAuth();
  const firstCaptures = useShowFirstCaptures();
  const { credits, isLoading: creditsLoading } = useAICredits();
  const { data: notes = [] } = useNotes("all");
  const navigate = useNavigate();
  const displayName = profile?.display_name || user?.email?.split("@")[0] || "there";

  const hasProfile = !!profile?.display_name;
  const hasNotes = notes.length > 0;
  const aiProcessedCount = notes.filter((n) => n.metadata && Object.keys(n.metadata).length > 0).length;

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
            {BRAND.dashboardSubline}
          </p>
        </div>
      </div>

      <NotesStatsRow
        notesCount={notes.length}
        aiProcessedCount={aiProcessedCount}
        credits={credits}
        creditsLoading={creditsLoading}
        role={role}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Quick start */}
          {!hasNotes && (
            <Card className="border-dashed">
              <CardContent className="py-8">
                <CaptureEmptyState onCreateNote={() => navigate("/dashboard/notes?action=create")} />
              </CardContent>
            </Card>
          )}

          {/* Recent notes */}
          {hasNotes && <RecentNotesCard notes={notes} />}

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
          <ProfileWidget />
          <TodaysConnections />
          <GroupPulseCard />
          <DiscoveryFeed />
          <OrphanNotesDetector compact />
          <BridgeNotesHighlighter compact />
          <GettingStartedChecklist hasProfile={hasProfile} hasNotes={hasNotes} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
