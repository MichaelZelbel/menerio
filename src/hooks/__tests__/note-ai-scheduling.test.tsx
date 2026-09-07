import { act, cleanup, renderHook, render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  job: null as null | { state: string; last_error?: string },
  local: false,
  invoke: vi.fn(),
  rpc: vi.fn(),
  save: vi.fn(),
  execute: vi.fn(),
  editorOptions: null as null | { onUpdate: (event: { editor: { getJSON: () => unknown; getText: () => string } }) => void },
  row: { id: "note-1", user_id: "user-1", title: "", content: "", tags: [], is_trashed: false },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
  functions: { invoke: state.invoke },
  rpc: state.rpc,
  from: () => {
    let writing = false;
    const query = {
      insert: (data: object) => { state.row = { ...state.row, ...data }; return query; },
      update: (data: object) => { writing = true; state.row = { ...state.row, ...data }; return query; },
      select: () => query, eq: (key: string, value: string) => { if (writing && key === "id") state.row.id = value; return query; },
      single: () => state.save({ ...state.row }),
      maybeSingle: async () => ({ data: state.job, error: null }),
    };
    return query;
  },
} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, session: { access_token: "fixture" } }) }));
vi.mock("@/sync/sync-health", () => ({ isLocalFirstActive: () => state.local, useLocalFirstActive: () => state.local }));
vi.mock("@/sync/db", () => ({ getDb: () => ({ execute: state.execute, get: async () => state.row }) }));
vi.mock("@/sync/notes-mapping", () => ({ rowToNote: (row: unknown) => row, toSqliteValue: (_key: string, value: unknown) => value }));
vi.mock("@powersync/tanstack-react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/lib/query-sync", () => ({ broadcastInvalidation: vi.fn() }));
vi.mock("@/lib/credits-events", () => ({ triggerCreditsRefresh: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: { error: vi.fn(), success: vi.fn() } }));
import { useProcessingSweep } from "../useProcessingSweep";
import { useCreateNote, useDuplicateNote, useUpdateNote, useProcessNote } from "../useNotes";

vi.mock("@/components/notes/ConnectionsPanel", () => ({ ConnectionsPanel: () => null }));
vi.mock("@/components/notes/ExternalNotePanel", () => ({ ExternalNotePanel: () => null }));
vi.mock("@/components/notes/WebClipPreview", () => ({ WebClipPreview: () => null }));
vi.mock("@/components/notes/ForwardToAppDialog", () => ({ ForwardToAppDialog: () => null }));
vi.mock("@/components/notes/WikilinkAutocomplete", () => ({ WikilinkAutocomplete: () => null }));
vi.mock("@/components/notes/EditorBubbleMenu", () => ({ EditorBubbleMenu: () => null }));
vi.mock("@/components/notes/BacklinksPanel", () => ({ BacklinksPanel: () => null }));
vi.mock("@/components/notes/OutgoingLinksPanel", () => ({ OutgoingLinksPanel: () => null }));
vi.mock("@/components/notes/SuggestedLinksPanel", () => ({ SuggestedLinksPanel: () => null }));
vi.mock("@/components/notes/MediaAnalysisOverlay", () => ({ MediaAnalysisOverlay: () => null }));
vi.mock("@/components/notes/NoteAttachmentsPanel", () => ({ NoteAttachmentsPanel: () => null }));
vi.mock("@/components/notes/LocalGraphPanel", () => ({ LocalGraphPanel: () => null }));
vi.mock("@/components/notes/NoteMetadataEditor", () => ({ NoteMetadataEditor: () => null }));
vi.mock("@/components/notes/LinkToNoteDialog", () => ({ LinkToNoteDialog: () => null }));
vi.mock("@/components/notes/NoteChatPanel", () => ({ NoteChatPanel: () => null }));
vi.mock("@/components/notes/EditorToolbar", () => ({ EditorToolbar: ({ noteActions }: { noteActions: ReactNode }) => <>{noteActions}</> }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return { DropdownMenu: Container, DropdownMenuTrigger: Container, DropdownMenuContent: Container, DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button> };
});
vi.mock("@/components/notes/VersionHistoryPanel", () => ({ VersionHistoryPanel: () => null }));
vi.mock("@/components/common/AiVisibilityButton", () => ({ AiVisibilityButton: () => null }));
vi.mock("@/hooks/useNoteSharing", () => ({ useSharedNote: () => ({}), useShareNote: () => ({}), useUnshareNote: () => ({}), useCopyShareLink: () => ({}) }));
vi.mock("@/hooks/useGitHubSync", () => ({ useGitHubConnection: () => ({}), useGitHubSyncExport: () => ({}), useSyncLogForNote: () => ({}) }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ checkCredits: () => true }) }));
vi.mock("@tiptap/react", () => ({ useEditor: (options: typeof state.editorOptions) => { state.editorOptions = options; return null; }, EditorContent: () => null }));
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note } from "../useNotes";
const editorNote = { id: "note-1", user_id: "user-1", title: "Title", content: "initial text here", tags: [], is_trashed: false, is_external: false, created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z" } as Note;
function typeContent(text: string) {
  act(() => state.editorOptions!.onUpdate({ editor: { getJSON: () => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }), getText: () => text } }));
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter></QueryClientProvider>;
}
beforeEach(() => {
  vi.useFakeTimers();
  state.local = false;
  state.job = null;
  localStorage.clear();
  state.row = { id: "note-1", user_id: "user-1", title: "", content: "", tags: [], is_trashed: false };
  state.invoke.mockReset().mockResolvedValue({ data: { accepted: true, queued: true }, error: null });
  state.save.mockReset().mockImplementation(async () => ({ data: { ...state.row }, error: null }));
  state.execute.mockReset().mockResolvedValue(undefined);
  state.rpc.mockReset().mockImplementation(async (_name, args) => ({ data: { ...state.row, ...args._note }, error: null }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("browser note scheduling", () => {
  it("saves a deliberate duplicate through atomic enrollment, not a follow-up request", async () => {
    const { result } = renderHook(() => useDuplicateNote(), { wrapper });
    await act(async () => { await result.current.mutateAsync("note-1"); });
    expect(state.rpc).toHaveBeenCalledWith("capture_note_with_lexicon", { _note: expect.objectContaining({ id: expect.any(String), user_id: "user-1", metadata: { duplicated_from: "note-1" } }) });
    expect(state.save).toHaveBeenCalledTimes(1); // source read only
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("flushes to the correct note when the same editor instance switches notes", async () => {
    const view = render(<NoteEditor note={editorNote} />, { wrapper });
    typeContent("final edit of first note");
    view.rerender(<NoteEditor note={{ ...editorNote, id: "note-2" }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ id: "note-1", content: "final edit of first note" }));
    typeContent("final edit of second note");
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: "note-2", content: "final edit of second note" }));
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("retries only the signed-in account's enrollment intents", async () => {
    localStorage.setItem("menerio:lexicon-enrollment:other-user:other-note", "other-note");
    localStorage.setItem("menerio:lexicon-enrollment:user-1:own-note", "own-note");
    renderHook(() => useProcessingSweep(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(state.invoke.mock.calls.filter(([name]) => name === "wiki-ingest")).toEqual([
      ["wiki-ingest", { body: { note_id: "own-note", change_type: "INSERT" } }],
    ]);
    expect(localStorage.getItem("menerio:lexicon-enrollment:other-user:other-note")).toBe("other-note");
    expect(localStorage.getItem("menerio:lexicon-enrollment:user-1:own-note")).toBeNull();
  });
  it("does not request manual work when the final save fails", async () => {
    state.save.mockResolvedValueOnce({ error: new Error("save failed") });
    const view = render(<NoteEditor note={editorNote} />, { wrapper });
    typeContent("retain this failed save");
    await act(async () => { fireEvent.click(view.getByText("Classify with AI")); });
    expect(state.invoke).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.save).toHaveBeenCalledTimes(2);
  });

  it("saves the final editor revision before requesting manual priority", async () => {
    const view = render(<NoteEditor note={editorNote} />, { wrapper });
    typeContent("manual request latest content");
    fireEvent.change(view.getByPlaceholderText("Untitled"), { target: { value: "Latest title" } });
    await act(async () => { fireEvent.click(view.getByText("Classify with AI")); });
    expect(state.row.content).toBe("manual request latest content");
    expect(state.row.title).toBe("Latest title");
    expect(state.save.mock.invocationCallOrder[0]).toBeLessThan(state.invoke.mock.invocationCallOrder[0]);
    expect(state.invoke).toHaveBeenCalledWith("process-note", { body: { note_id: "note-1", reason: "manual" } });
  });

  it("confirms capture only after the atomic save and enrollment succeeds", async () => {
    let finish!: (value: unknown) => void;
    state.rpc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useCreateNote(), { wrapper });
    let saved = false;
    act(() => { void result.current.mutateAsync({ title: "Fast save" }).then(() => { saved = true; }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(saved).toBe(false);
    expect(state.save).not.toHaveBeenCalled();
    await act(async () => { finish({ data: state.row, error: null }); });
    expect(saved).toBe(true);
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("does not fall back to an unenrolled insert if atomic capture fails", async () => {
    state.rpc.mockResolvedValueOnce({ error: new Error("network failure") });
    const capture = renderHook(() => useCreateNote(), { wrapper });
    await act(async () => { await expect(capture.result.current.mutateAsync({ title: "Captured" })).rejects.toThrow("network failure"); });
    capture.unmount();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it.each([["pending", "Queued for indexing"], ["running", "Indexing…"], ["parked", "Indexing needs attention"], ["failed", "Indexing failed"]])("shows actual durable %s state even when the note still says processed", async (status, label) => {
    state.job = { state: status };
    const view = render(<NoteEditor note={{ ...editorNote, processing_status: "processed" }} />, { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(view.getByText(label)).toBeInTheDocument();
  });

  it("flushes the last content and title save on tab hide without requesting AI", async () => {
    const view = render(<NoteEditor note={editorNote} />, { wrapper });
    typeContent("final content before hiding");
    fireEvent.change(view.getByPlaceholderText("Untitled"), { target: { value: "Final title" } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(state.row.content).toBe("final content before hiding");
    expect(state.row.title).toBe("Final title");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    view.unmount();
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.invoke).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  it("saves rapid editor typing but never requests processing after ten-second pauses or note switching", async () => {
    const view = render(<NoteEditor note={editorNote} />, { wrapper });
    typeContent("first text revision");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    typeContent("final text revision");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(state.row.content).toBe("final text revision");
    typeContent("last burst before navigation");
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(state.row.content).toBe("last burst before navigation");
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("preserves exact title and formatting saves without browser AI timers in two tabs", async () => {
    const first = renderHook(() => useUpdateNote(), { wrapper });
    const second = renderHook(() => useUpdateNote(), { wrapper });
    for (const [hook, changes] of [
      [first, { content: "one two three" }],
      [first, { content: "one two three final" }],
      [second, { title: "Title only" }],
      [first, { content: "**one two three final**" }],
    ] as const) {
      await act(async () => { await hook.result.current.mutateAsync({ id: "note-1", ...changes }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    }
    first.unmount();
    second.unmount();
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.row.content).toBe("**one two three final**");
    expect(state.row.title).toBe("Title only");
    expect(state.save).toHaveBeenCalledTimes(4);
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("atomically enrolls an empty first server save without a second request", async () => {
    const { result, unmount } = renderHook(() => useCreateNote(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ title: "", content: "" }); });
    expect(state.rpc).toHaveBeenCalledWith("capture_note_with_lexicon", { _note: { id: expect.any(String), user_id: "user-1", title: "", content: "" } });
    expect(state.save).not.toHaveBeenCalled();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("does not enroll an offline note before upload", async () => {
    state.local = true;
    const { result } = renderHook(() => useCreateNote(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ content: "Offline note with enough text to qualify" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.execute).toHaveBeenCalledTimes(1);
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("marks only explicit processing requests as manual priority", async () => {
    const { result } = renderHook(() => useProcessNote(), { wrapper });
    await act(async () => { await result.current.mutateAsync("note-1"); });
    expect(state.invoke).toHaveBeenCalledWith("process-note", { body: { note_id: "note-1", reason: "manual" } });
  });
});
