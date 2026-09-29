import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Row = Record<string, unknown>;

const pages: Row[] = [
  { id: "pa", slug: "alpha", title: "Alpha", summary: null, content: "Alpha body", page_type: "concept", source_count: 0, updated_at: "2026-09-01T00:00:00Z" },
  { id: "pb", slug: "beta", title: "Beta", summary: null, content: "Beta body", page_type: "concept", source_count: 0, updated_at: "2026-09-01T00:00:00Z" },
];
const state = { pageReadFails: false };

function query(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => {
    if (table !== "wiki_pages") return [];
    return pages.filter((row) => filters.every(([c, v]) => row[c] === v));
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    in: () => builder,
    or: () => builder,
    order: () => builder,
    maybeSingle: async () => {
      if (table === "wiki_pages" && state.pageReadFails) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      return { data: rows()[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => query(table), rpc: async () => ({ error: null }), functions: { invoke: async () => ({ data: null, error: null }) } },
}));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
// The real editor is TipTap; a textarea is enough to make edits.
vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({ value, editable, onChange }: { value: string; editable: boolean; onChange?: (v: string) => void }) =>
    editable ? <textarea aria-label="Page text" defaultValue={value} onChange={(e) => onChange?.(e.target.value)} /> : <article>{value}</article>,
}));

import WikiPage from "@/pages/WikiPage";

function renderAt(slug: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/lexicon/${slug}`]}>
        <Routes>
          <Route path="/lexicon/:slug" element={<WikiPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.pageReadFails = false;
});

async function startEditing() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  return screen.findByLabelText("Page text");
}

describe("WikiPage", () => {
  it("leaves edit mode when a link opens another page", async () => {
    renderAt("alpha");
    await startEditing();
    fireEvent.click(screen.getByRole("link", { name: "Beta" }));
    expect(await screen.findByText("Beta body")).toBeInTheDocument();
    expect(screen.queryByLabelText("Page text")).not.toBeInTheDocument();
  });

  it("asks before a link drops unsaved edits, and stays when told to", async () => {
    renderAt("alpha");
    const editor = await startEditing();
    fireEvent.change(editor, { target: { value: "Alpha body, edited" } });
    fireEvent.click(screen.getByRole("link", { name: "Beta" }));
    expect(await screen.findByText("Discard your unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard your unsaved changes?")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Page text")).toHaveValue("Alpha body, edited");
  });

  it("goes to the other page when the edits are discarded", async () => {
    renderAt("alpha");
    const editor = await startEditing();
    fireEvent.change(editor, { target: { value: "Alpha body, edited" } });
    fireEvent.click(screen.getByRole("link", { name: "Beta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("Beta body")).toBeInTheDocument();
    expect(screen.queryByLabelText("Page text")).not.toBeInTheDocument();
  });

  it("says the page could not be loaded, not that it does not exist, when the read fails", async () => {
    state.pageReadFails = true;
    renderAt("alpha");
    expect(await screen.findByText("This page could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("This page doesn't exist yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
