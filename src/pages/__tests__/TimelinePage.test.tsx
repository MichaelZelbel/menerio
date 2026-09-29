import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {};
const failures: { freshParticipants: boolean; participantsList: boolean } = { freshParticipants: false, participantsList: false };

function query(table: string) {
  const filters: [string, unknown][] = [];
  let range: [number, number] | null = null;
  const result = () => {
    const isFreshRead = table === "moment_participants" && filters.some(([c]) => c === "moment_id");
    if (isFreshRead && failures.freshParticipants) return { data: null, error: { message: "permission denied for table moment_participants" } };
    if (table === "moment_participants" && !isFreshRead && failures.participantsList) return { data: null, error: { message: "JWT expired" } };
    let rows = (db[table] || []).filter((row) => filters.every(([c, v]) => c === "user_id" || row[c] === v));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    is: () => builder,
    order: () => builder,
    range: (from: number, to: number) => { range = [from, to]; return builder; },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => query(table) } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ showToast: { error: (m: string) => toastError(m), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
// The dialog itself is not under test here: what matters is the participant
// list the page hands it, because saving removes everyone missing from it.
vi.mock("@/components/timeline/AddEventDialog", () => ({
  default: ({ editEvent, open }: { editEvent?: { participantIds?: string[] } | null; open?: boolean }) =>
    editEvent && open ? <div data-testid="edit-dialog">{(editEvent.participantIds || []).join(",")}</div> : null,
}));

import TimelinePage from "@/pages/TimelinePage";

const moment = {
  id: "m1", user_id: "u1", happened_at: "2026-05-01T00:00:00Z", happened_end: null, title: "Trip to Lisbon", description: null,
  status: "past_fact", confidence_date: 5, confidence_truth: 5, impact_level: 2, source: "manual", verified: false, is_potential_major: false,
};

beforeEach(() => {
  failures.freshParticipants = false;
  failures.participantsList = false;
  toastError.mockClear();
  db.moments = [moment];
  // "p-merged" is not in the contacts list (merged away, or past a capped read).
  db.contacts = [{ id: "p1", name: "Ana", relationship: null }];
  db.moment_participants = [{ moment_id: "m1", person_id: "p1" }, { moment_id: "m1", person_id: "p-merged" }];
  db.moment_provenance = [];
});

function renderPage() {
  return render(<MemoryRouter><TimelinePage /></MemoryRouter>);
}

async function openEditFromDrawer() {
  fireEvent.click(await screen.findByText("Trip to Lisbon"));
  fireEvent.click(await screen.findByRole("button", { name: /Edit Moment/ }));
}

describe("TimelinePage edit", () => {
  it("opens the editor with every participant read fresh, including people not in the contacts list", async () => {
    renderPage();
    await openEditFromDrawer();
    expect(await screen.findByTestId("edit-dialog")).toHaveTextContent("p1,p-merged");
  });

  it("does not open the editor when this moment's participants cannot be read", async () => {
    renderPage();
    failures.freshParticipants = true;
    await openEditFromDrawer();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).not.toMatch(/permission denied/);
    expect(screen.queryByTestId("edit-dialog")).not.toBeInTheDocument();
  });

  it("shows a failed load, not an empty timeline, when participants cannot be read", async () => {
    failures.participantsList = true;
    renderPage();
    expect(await screen.findByText("Your timeline could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No moments yet")).not.toBeInTheDocument();
  });
});
