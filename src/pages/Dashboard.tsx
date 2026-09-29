import type { ReactNode } from "react";
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
import { RecentPeopleCard } from "@/components/dashboard/widgets/RecentPeopleCard";
import { ProfileWidget } from "@/components/dashboard/widgets/ProfileWidget";
import { GroupPulseCard } from "@/components/dashboard/widgets/GroupPulseCard";
import { GettingStartedChecklist } from "@/components/dashboard/widgets/GettingStartedChecklist";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/LoadingStates";

interface LayoutProps {
  notes: ReturnType<typeof useNotes>["data"] & {};
  hasNotes: boolean;
  /** Whether the notes are known yet: a load in flight or a failed load is not "no notes". */
  notesStatus: "loading" | "error" | "ready";
  onRetryNotes: () => void;
  hasProfile: boolean;
  hasAiNote: boolean;
  onCreateNote: () => void;
  firstCapturesSlot?: ReactNode;
}

/** The default arrangement: notes front and center. */
const NotesFirstLayout = ({ notes, hasNotes, notesStatus, onRetryNotes, hasProfile, hasAiNote, onCreateNote, firstCapturesSlot }: LayoutProps) => (
  <div className="grid gap-6 lg:grid-cols-3">
    <div className="lg:col-span-2 space-y-6">
      {!hasNotes && notesStatus === "loading" && <CardSkeleton />}
      {!hasNotes && notesStatus === "error" && <NotesLoadError onRetry={onRetryNotes} />}
      {!hasNotes && notesStatus === "ready" && (
        <Card className="border-dashed">
          <CardContent className="py-8">
            <CaptureEmptyState onCreateNote={onCreateNote} />
          </CardContent>
        </Card>
      )}
      {hasNotes && <RecentNotesCard notes={notes} />}
      <ActivityFeed limit={5} showViewAll />
    </div>

    {firstCapturesSlot && <div className="lg:col-span-3">{firstCapturesSlot}</div>}

    <div className="space-y-6">
      <ProfileWidget />
      <TodaysConnections />
      <GroupPulseCard />
      <DiscoveryFeed />
      <OrphanNotesDetector compact />
      <BridgeNotesHighlighter compact />
      <GettingStartedChecklist hasProfile={hasProfile} hasNotes={hasNotes} hasAiNote={hasAiNote} />
    </div>
  </div>
);

/** A failed notes load, said as one, instead of the "capture your first note" empty state. */
const NotesLoadError = ({ onRetry }: { onRetry: () => void }) => (
  <Card role="alert">
    <CardContent className="flex flex-col items-start gap-3 py-6 text-sm">
      <p>Your notes could not be loaded. Check your connection and try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </CardContent>
  </Card>
);

/** Cherishly's arrangement: the people you cherish come first. */
const PeopleFirstLayout = ({ notes, hasNotes, hasProfile, hasAiNote, firstCapturesSlot }: LayoutProps) => (
  <div className="grid gap-6 lg:grid-cols-3">
    <div className="lg:col-span-2 space-y-6">
      <TodaysConnections />
      <RecentPeopleCard />
      <GroupPulseCard />
    </div>

    {firstCapturesSlot && <div className="lg:col-span-3">{firstCapturesSlot}</div>}

    <div className="space-y-6">
      {hasNotes && <RecentNotesCard notes={notes} />}
      <ActivityFeed limit={5} />
      <ProfileWidget />
      <GettingStartedChecklist hasProfile={hasProfile} hasNotes={hasNotes} hasAiNote={hasAiNote} />
    </div>
  </div>
);

const Dashboard = () => {
  const { profile, role, user } = useAuth();
  const firstCaptures = useShowFirstCaptures();
  const { credits, isLoading: creditsLoading } = useAICredits();
  const { data: notes = [], isLoading: notesLoading, isError: notesFailed, refetch: refetchNotes } = useNotes("all");
  // Until the notes are known, "no notes" is not a fact: the empty state
  // ("capture your first note") used to show while they loaded, and for good
  // when the load failed.
  const notesStatus: LayoutProps["notesStatus"] = notesLoading ? "loading" : notesFailed ? "error" : "ready";
  const navigate = useNavigate();
  const displayName = profile?.display_name || user?.email?.split("@")[0] || "there";

  const hasProfile = !!profile?.display_name;
  const hasNotes = notes.length > 0;
  const aiProcessedCount = notes.filter((n) => n.metadata && Object.keys(n.metadata).length > 0).length;
  const peopleFirst = BRAND.dashboardVariant === "people-first";

  return (
    <div className="space-y-6">
      <SEOHead title="Dashboard — Menerio" noIndex />
      {/* Welcome */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">
            {hasNotes ? "Welcome back" : "Welcome"}, {displayName} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {BRAND.dashboardSubline}
          </p>
        </div>
      </div>

      {!peopleFirst && (
        <NotesStatsRow
          notesCount={notes.length}
          aiProcessedCount={aiProcessedCount}
          credits={credits}
          creditsLoading={creditsLoading}
          role={role}
        />
      )}

      {peopleFirst ? (
        <PeopleFirstLayout
          notes={notes}
          hasNotes={hasNotes}
          notesStatus={notesStatus}
          onRetryNotes={() => void refetchNotes()}
          hasProfile={hasProfile}
          hasAiNote={aiProcessedCount > 0}
          onCreateNote={() => navigate("/dashboard/notes?action=create")}
          firstCapturesSlot={firstCaptures.show ? <FirstCapturesWizard onComplete={firstCaptures.dismiss} /> : undefined}
        />
      ) : (
        <NotesFirstLayout
          notes={notes}
          hasNotes={hasNotes}
          notesStatus={notesStatus}
          onRetryNotes={() => void refetchNotes()}
          hasProfile={hasProfile}
          hasAiNote={aiProcessedCount > 0}
          onCreateNote={() => navigate("/dashboard/notes?action=create")}
          firstCapturesSlot={firstCaptures.show ? <FirstCapturesWizard onComplete={firstCaptures.dismiss} /> : undefined}
        />
      )}
    </div>
  );
};

export default Dashboard;
