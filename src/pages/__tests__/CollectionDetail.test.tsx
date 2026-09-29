import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import CollectionDetail from "../CollectionDetail";

type Row = Record<string, unknown>;
type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  select?: string;
  filters: Array<[string, string, unknown]>;
  payload?: unknown;
};

// A small in-memory PostgREST: enough of the query builder for this page.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Call[],
  nextId: 1,
}));

vi.mock("@/integrations/supabase/client", () => {
  const matches = (row: Row, filters: Call["filters"]) =>
    filters.every(([op, column, value]) => {
      if (op === "eq") return row[column] === value;
      if (op === "in") return (value as unknown[]).includes(row[column]);
      if (op === "is") return (row[column] ?? null) === value;
      return true;
    });
  const run = (call: Call & { single: boolean; maybe: boolean; range: [number, number] | null }) => {
    db.calls.push(call);
    const table = (db.tables[call.table] ??= []);
    const hits = table.filter((row) => matches(row, call.filters));
    const one = (rows: Row[]) =>
      call.single || call.maybe
        ? { data: rows[0] ? structuredClone(rows[0]) : null, error: rows[0] || call.maybe ? null : { message: "no rows" } }
        : { data: structuredClone(rows), error: null };
    if (call.op === "insert") {
      const payload = call.payload as Row;
      const data = payload.data as Row | undefined;
      const row: Row = {
        id: `new-${db.nextId++}`,
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
        folder_id: null,
        is_favorite: false,
        last_viewed_at: null,
        ...payload,
        title: data?.title ?? null,
      };
      table.push(row);
      return one([row]);
    }
    if (call.op === "update") {
      const updated = hits.map((row) => {
        const next = { ...row, ...(call.payload as Row) };
        const data = next.data as Row | undefined;
        if (data && typeof data.title === "string") next.title = data.title;
        table[table.indexOf(row)] = next;
        return next;
      });
      return one(updated);
    }
    if (call.op === "delete") {
      db.tables[call.table] = table.filter((row) => !hits.includes(row));
      return { data: null, error: null };
    }
    return one(call.range ? hits.slice(call.range[0], call.range[1] + 1) : hits);
  };
  const builder = (tableName: string) => {
    const call = {
      table: tableName,
      op: "select" as Call["op"],
      select: undefined as string | undefined,
      filters: [] as Call["filters"],
      payload: undefined as unknown,
      single: false,
      maybe: false,
      range: null as [number, number] | null,
    };
    const chain: Record<string, unknown> = {
      select: (columns?: string) => ((call.select = columns), chain),
      insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), chain),
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), chain),
      delete: () => ((call.op = "delete"), chain),
      eq: (column: string, value: unknown) => (call.filters.push(["eq", column, value]), chain),
      is: (column: string, value: unknown) => (call.filters.push(["is", column, value]), chain),
      in: (column: string, value: unknown) => (call.filters.push(["in", column, value]), chain),
      not: () => chain,
      or: () => chain,
      ilike: () => chain,
      filter: () => chain,
      order: () => chain,
      limit: () => chain,
      range: (from: number, to: number) => ((call.range = [from, to]), chain),
      single: () => ((call.single = true), chain),
      maybeSingle: () => ((call.maybe = true), chain),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run(call)).then(resolve, reject),
    };
    return chain;
  };
  return { supabase: { from: builder } };
});

const auth = vi.hoisted(() => ({ value: { user: { id: "u1" } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/collections/CollectionChatPanel", () => ({ CollectionChatPanel: () => null }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

function seed() {
  db.calls = [];
  db.nextId = 1;
  db.tables = {
    collections: [
      {
        id: "c-books",
        user_id: "u1",
        slug: "books",
        name: "Books",
        icon: "📚",
        description: null,
        visibility: "private",
        field_schema: [
          { key: "title", label: "Title", type: "text", primary: true },
          { key: "rating", label: "Rating", type: "number" },
          { key: "related", label: "Related", type: "link_collection_item" },
        ],
      },
      {
        id: "c-movies",
        user_id: "u1",
        slug: "movies",
        name: "Movies",
        icon: "🎬",
        description: null,
        visibility: "private",
        field_schema: [{ key: "name", label: "Name", type: "text", primary: true }],
      },
    ],
    collection_items: [
      {
        id: "i1",
        user_id: "u1",
        collection_id: "c-books",
        title: "Dune",
        data: {
          title: "Dune",
          rating: 5,
          duplicated_from: "i0",
          mcp_note: "written by the AI",
          related: { type: "collection_item", id: "m1", label: "Arrival", collection_id: "c-movies" },
        },
        folder_id: null,
        is_favorite: false,
        last_viewed_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      {
        id: "m1",
        user_id: "u1",
        collection_id: "c-movies",
        title: "Arrival",
        data: { name: "Arrival" },
        folder_id: null,
        is_favorite: false,
        last_viewed_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
    collection_item_folders: [{ id: "f1", user_id: "u1", collection_id: "c-books", name: "Classics", parent_folder_id: null }],
    notes: [],
    contacts: [],
  };
}

function Where() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/collections/:slug" element={<CollectionDetail />} />
          <Route path="/collections/:slug/:itemId" element={<CollectionDetail />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const itemLoads = () =>
  db.calls.filter((call) => call.table === "collection_items" && call.op === "select" && call.select?.includes("data")).length;
const titleInput = () =>
  screen.getAllByRole("textbox").find((element) => element.getAttribute("aria-label") !== "Search items") as HTMLInputElement;

describe("CollectionDetail", () => {
  beforeEach(() => {
    seed();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("filters in memory: typing a search does not download the collection again", async () => {
    renderAt("/collections/books");
    await screen.findByRole("cell", { name: "Dune" });
    const loads = itemLoads();
    const [search] = screen.getAllByLabelText("Search items");
    fireEvent.change(search, { target: { value: "Dun" } });
    fireEvent.change(search, { target: { value: "Dune" } });
    await act(async () => {});
    expect(itemLoads()).toBe(loads);
    const load = db.calls.find((call) => call.table === "collection_items" && call.select?.includes("data"));
    expect(load?.select).not.toContain("*");
    expect(load?.select).not.toContain("search_vector");
  });

  it("keeps unsaved typing when the collection reloads, and saves onto the stored data", async () => {
    renderAt("/collections/books/i1");
    await waitFor(() => expect(screen.getByDisplayValue("Dune")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("Dune"), { target: { value: "Dune Messiah" } });

    // The AI changes the rating meanwhile and tells the page.
    const stored = db.tables.collection_items.find((row) => row.id === "i1")!;
    stored.data = { ...(stored.data as Row), rating: 4 };
    const loads = itemLoads();
    act(() => {
      window.dispatchEvent(new CustomEvent("menerio:collection-updated", { detail: { collectionId: "c-books" } }));
    });
    await waitFor(() => expect(itemLoads()).toBeGreaterThan(loads));
    await act(async () => {});
    expect(screen.getByDisplayValue("Dune Messiah")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(db.calls.some((call) => call.op === "update" && call.table === "collection_items" && (call.payload as Row).data)).toBe(true));
    const update = db.calls.find((call) => call.op === "update" && (call.payload as Row).data)!;
    expect((update.payload as Row).data).toEqual({
      title: "Dune Messiah",
      rating: 4,
      duplicated_from: "i0",
      mcp_note: "written by the AI",
      related: { type: "collection_item", id: "m1", label: "Arrival", collection_id: "c-movies" },
    });
  });

  it("creates one item when Ctrl+Enter is pressed twice, in the folder it was started from", async () => {
    renderAt("/collections/books/new?folder=f1");
    await waitFor(() => expect(titleInput()).toBeTruthy());
    // The folder list loads with the tree.
    await waitFor(() => expect(db.calls.some((call) => call.table === "collection_item_folders")).toBe(true));
    await act(async () => {});
    fireEvent.change(titleInput(), { target: { value: "Neuromancer" } });
    const folderLoads = db.calls.filter((call) => call.table === "collection_item_folders").length;
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId("location").textContent).toMatch(/^\/collections\/books\/new-1/));
    const inserts = db.calls.filter((call) => call.op === "insert" && call.table === "collection_items");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ folder_id: "f1", data: { title: "Neuromancer" } });
    // The sidebar tree reloads so it lists the new item.
    expect(db.calls.filter((call) => call.table === "collection_item_folders").length).toBeGreaterThan(folderLoads);
  });

  it("opens a linked item of another collection under that collection", async () => {
    renderAt("/collections/books");
    const chip = await screen.findByRole("button", { name: "Arrival" });
    await act(async () => {});
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/collections/movies/m1"));
  });

  it("does not open another collection's item under this collection's URL", async () => {
    renderAt("/collections/books/m1");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/collections/books"));
    expect(toasts.error).toHaveBeenCalledWith("Item not found");
    const fetch = db.calls.find((call) => call.filters.some(([, column, value]) => column === "id" && value === "m1"));
    expect(fetch?.filters).toContainEqual(["eq", "collection_id", "c-books"]);
    expect(screen.queryByDisplayValue("Arrival")).not.toBeInTheDocument();
  });

  it("shows a failed load as a failure with Retry, not as an empty collection", async () => {
    db.tables.collections = [];
    renderAt("/collections/books");
    expect(await screen.findByText("This collection could not be found.")).toBeInTheDocument();
    expect(screen.queryByText("No items yet")).not.toBeInTheDocument();
  });
});
