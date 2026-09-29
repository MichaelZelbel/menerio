import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { VersionHistoryPanel } from "../VersionHistoryPanel";

// Regressions from the notes review of 2026-09-29:
// - Opening version A (slow) and then B landed A's content under B's header,
//   and Restore wrote A.
// - The frontmatter title kept the export's \" and \\ escapes on restore.
// - The Markdown was converted to HTML here and again by the preview editor,
//   so an escaped \* showed as italics.

const hooks = vi.hoisted(() => ({
  fetchFile: vi.fn(),
  updateNote: vi.fn(),
  historyFailed: false,
  refetchHistory: vi.fn(),
}));

vi.mock("@/hooks/useGitHubSync", () => ({
  useGitHubVersionHistory: () => ({
    data: hooks.historyFailed
      ? undefined
      : [
          { sha: "aaaaaaa1111", commit: { author: { date: "2026-09-01T10:00:00Z", name: "M" }, message: "Version A" } },
          { sha: "bbbbbbb2222", commit: { author: { date: "2026-09-02T10:00:00Z", name: "M" }, message: "Version B" } },
        ],
    isLoading: false,
    isError: hooks.historyFailed,
    refetch: hooks.refetchHistory,
  }),
  useSyncLogForNote: () => ({ data: { github_path: "notes/budget.md" } }),
  useGitHubFileAtCommit: () => ({ mutateAsync: hooks.fetchFile }),
}));

vi.mock("@/hooks/useNotes", () => ({
  useNote: () => ({ data: { title: "Budget", content: "current body" } }),
  useUpdateNote: () => ({ mutateAsync: hooks.updateNote, isPending: false }),
}));

// The real preview is a read-only TipTap editor that converts Markdown itself;
// show exactly what it is handed.
vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({ value }: { value: string }) => <pre data-testid="preview">{value}</pre>,
}));

vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const file = (title: string, body: string) => `---\ntitle: ${title}\n---\n${body}`;

beforeEach(() => {
  hooks.historyFailed = false;
  hooks.refetchHistory.mockReset();
  hooks.fetchFile.mockReset();
  hooks.updateNote.mockReset();
  hooks.updateNote.mockResolvedValue({});
});
afterEach(cleanup);

async function restore() {
  fireEvent.click(screen.getByRole("button", { name: /restore this version/i }));
  fireEvent.click(await screen.findByRole("button", { name: /^restore$/i }));
  await waitFor(() => expect(hooks.updateNote).toHaveBeenCalledTimes(1));
  return hooks.updateNote.mock.calls[0][0] as { title: string; content: string };
}

describe("VersionHistoryPanel", () => {
  it("shows and restores the version clicked last, even when an earlier click answers later", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    hooks.fetchFile.mockImplementation(({ commitSha }: { commitSha: string }) =>
      commitSha.startsWith("a") ? a.promise : b.promise,
    );
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);

    fireEvent.click(screen.getByText("Version A"));
    fireEvent.click(screen.getAllByText("Version B")[0]);

    await act(async () => b.resolve(file('"Title B"', "Body of B")));
    await act(async () => a.resolve(file('"Title A"', "Body of A")));

    expect(screen.getByTestId("preview")).toHaveTextContent("Body of B");
    expect(screen.queryByText(/Body of A/)).not.toBeInTheDocument();

    const saved = await restore();
    expect(saved).toMatchObject({ id: "n1", title: "Title B", content: "Body of B" });
  });

  it("unescapes the frontmatter title and hands the preview the Markdown once", async () => {
    hooks.fetchFile.mockResolvedValue(file('"Say \\"hi\\" to C:\\\\temp"', "Keep \\*this\\* literal"));
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);

    fireEvent.click(screen.getByText("Version A"));
    const preview = await screen.findByTestId("preview");
    // Markdown, not HTML converted here first.
    expect(preview.textContent).toBe("Keep \\*this\\* literal");

    const saved = await restore();
    expect(saved.title).toBe('Say "hi" to C:\\temp');
    expect(saved.content).toBe("Keep \\*this\\* literal");
  });

  it("explains a failed load in plain words, never the client library's text", async () => {
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "This file is no longer in the repository." }), { status: 404 }),
    });
    hooks.fetchFile.mockRejectedValueOnce(httpError);
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Version A"));
    expect(await screen.findByText("This file is no longer in the repository.")).toBeInTheDocument();
    expect(screen.queryByText(/non-2xx/)).not.toBeInTheDocument();
  });

  it("does not call an empty answer 'offline'", async () => {
    hooks.fetchFile.mockRejectedValueOnce(new Error("GitHub returned no content for this version"));
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Version A"));
    expect(await screen.findByText("Couldn't load this version from GitHub.")).toBeInTheDocument();
  });

  it("reads a single-quoted title", async () => {
    hooks.fetchFile.mockResolvedValue(file("'It''s done'", "Body"));
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Version A"));
    await screen.findByTestId("preview");

    const saved = await restore();
    expect(saved.title).toBe("It's done");
  });

  it("says the history could not be loaded instead of 'No version history yet'", () => {
    hooks.historyFailed = true;
    render(<VersionHistoryPanel noteId="n1" onClose={() => {}} />);
    expect(screen.queryByText(/No version history yet/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded from GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(hooks.refetchHistory).toHaveBeenCalledOnce();
  });
});
