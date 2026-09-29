import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const notesState = vi.hoisted(() => ({
  value: { data: undefined as unknown[] | undefined, isLoading: true, isError: false, refetch: vi.fn() },
}));

vi.mock("@/hooks/useNotes", () => ({ useNotes: () => notesState.value }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: null, role: "free", user: { id: "u1", email: "a@example.com" } }) }));
vi.mock("@/hooks/useAICredits", () => ({ useAICredits: () => ({ credits: null, isLoading: false }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/activity/ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("@/components/onboarding/FirstCapturesWizard", () => ({
  FirstCapturesWizard: () => null,
  useShowFirstCaptures: () => ({ show: false, dismiss: () => {} }),
}));
vi.mock("@/components/dashboard/TodaysConnections", () => ({ TodaysConnections: () => null }));
vi.mock("@/components/dashboard/DiscoveryFeed", () => ({ DiscoveryFeed: () => null }));
vi.mock("@/components/graph/OrphanNotesDetector", () => ({ OrphanNotesDetector: () => null }));
vi.mock("@/components/graph/GraphAnalytics", () => ({ BridgeNotesHighlighter: () => null }));
vi.mock("@/components/notes/CaptureEmptyState", () => ({ CaptureEmptyState: () => <p>Capture your first note</p> }));
vi.mock("@/components/dashboard/widgets/NotesStatsRow", () => ({ NotesStatsRow: () => null }));
vi.mock("@/components/dashboard/widgets/RecentNotesCard", () => ({ RecentNotesCard: () => <p>Recent notes</p> }));
vi.mock("@/components/dashboard/widgets/RecentPeopleCard", () => ({ RecentPeopleCard: () => null }));
vi.mock("@/components/dashboard/widgets/ProfileWidget", () => ({ ProfileWidget: () => null }));
vi.mock("@/components/dashboard/widgets/GroupPulseCard", () => ({ GroupPulseCard: () => null }));
vi.mock("@/components/dashboard/widgets/GettingStartedChecklist", () => ({ GettingStartedChecklist: () => null }));

import Dashboard from "@/pages/Dashboard";
import { BRAND } from "@/lib/brand";

const renderDashboard = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);

afterEach(cleanup);

describe.skipIf(BRAND.dashboardVariant === "people-first")("Dashboard notes states", () => {
  it("does not offer the first-note empty state while the notes are still loading", () => {
    notesState.value = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    renderDashboard();
    expect(screen.queryByText("Capture your first note")).toBeNull();
  });

  it("says the notes could not be loaded instead of claiming there are none", () => {
    const refetch = vi.fn();
    notesState.value = { data: undefined, isLoading: false, isError: true, refetch };
    renderDashboard();
    expect(screen.queryByText("Capture your first note")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Your notes could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the empty state once the account really has no notes", () => {
    notesState.value = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderDashboard();
    expect(screen.getByText("Capture your first note")).toBeInTheDocument();
  });
});
