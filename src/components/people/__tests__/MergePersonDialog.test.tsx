import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MergePersonDialog } from "../MergePersonDialog";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/toast", () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

const invokeMock = vi.fn(async (..._args: unknown[]) => ({ data: { success: true }, error: null }));

const contacts = Array.from({ length: 61 }, (_, i) => ({ id: `p-${i}`, name: i === 60 ? 'Zoe Beyond Page' : `Person ${String(i).padStart(2, '0')}`, aliases: [] }));
let topicCountValue = 0;
let contactRows = contacts;
const rpcMock = vi.fn((_name: string, args: any) => ({ abortSignal: async () => {
  const all = [...contactRows, { id: 'p-source', name: 'Alice', aliases: [] }, { id: 'p-bob', name: 'Bob', aliases: [] }]
    .filter(p => p.id !== args.exclude_contact_id && p.name.toLowerCase().includes(args.search_text.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name));
  const start = args.after_id ? all.findIndex(p => p.id === args.after_id) + 1 : 0;
  const rows = all.slice(start, start + args.page_size);
  return { data: { rows, total: all.length, next: start + rows.length < all.length ? rows.at(-1) : null }, error: null };
}}));
beforeEach(() => { topicCountValue = 0; contactRows = contacts; rpcMock.mockClear(); invokeMock.mockClear(); });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: [string, any]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: () => {
      const query = { select: () => query, eq: () => query, abortSignal: () => ({ then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: topicCountValue, error: null }).then(resolve), maybeSingle: async () => ({ data: null, error: null }) }) };
      return query;
    },
  },
}));

function renderDialog(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MergePersonDialog
        open
        onOpenChange={vi.fn()}
        sourcePerson={{ id: "p-source", name: "Duplicate Dana", aliases: [] }}
        allPeople={[
          { id: "p-source", name: "Duplicate Dana", aliases: [] },
          { id: "p-target", name: "Real Dana", aliases: [] },
        ]}
        onMergeComplete={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("MergePersonDialog — cache invalidation (regression: ghost membership counts after merge)", () => {
  it("invalidates contact_group_memberships and person_groups (alongside contacts) once the merge succeeds", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    renderDialog(qc);

    // Pick "Me (my own profile)" as the merge target.
    fireEvent.click(screen.getByText("Me (my own profile)").closest("button")!);
    // Confirmation dialog opens; confirm the merge.
    await waitFor(() => expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    // Wait for the mutation's onSuccess to have run.
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
        JSON.stringify((call[0] as { queryKey?: unknown })?.queryKey),
      );
      expect(invalidatedKeys).toContain(JSON.stringify(["contacts"]));
      expect(invalidatedKeys).toContain(JSON.stringify(["contact_group_memberships"]));
      expect(invalidatedKeys).toContain(JSON.stringify(["person_groups"]));
    });
  });
});


describe("merge candidates across all contact pages", () => {
  function filteredAlice() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={qc}><MergePersonDialog open onOpenChange={vi.fn()}
      sourcePerson={{ id: 'p-source', name: 'Alice', aliases: [] }}
      allPeople={[{ id: 'p-source', name: 'Alice', aliases: [] }]} onMergeComplete={vi.fn()} /> </QueryClientProvider>);
  }
  it("finds Bob when the main list contains only the Alice search result", async () => {
    contactRows = []; // Just Alice and Bob, independent of the loaded main-list filter.
    filteredAlice();
    fireEvent.change(screen.getByPlaceholderText('Search people...'), { target: { value: 'Bob' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bob' })).toBeVisible());
    expect(rpcMock).toHaveBeenCalledWith('search_contacts_page', expect.objectContaining({ search_text: 'Bob', exclude_contact_id: 'p-source', after_id: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));
    expect(within(screen.getByRole('alertdialog')).getByText('Bob')).toBeVisible();
  });
  it("loads targets beyond the first 50 and displays the eligible total", async () => {
    filteredAlice();
    await waitFor(() => expect(screen.getByText('50 of 62 people')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Zoe Beyond Page' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zoe Beyond Page' })).toBeVisible());
    expect(screen.getByText('62 of 62 people')).toBeVisible();
  });
  it("searches and pages topic recipients independently of the merge list", async () => {
    topicCountValue = 2;
    filteredAlice();
    fireEvent.change(screen.getByPlaceholderText('Search people...'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByText('Me (my own profile)').closest('button')!);
    const dialog = screen.getByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Load more recipients' })).toBeVisible());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load more recipients' }));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Zoe Beyond Page' })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText('Search topic recipients'), { target: { value: 'Bob' } });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Bob' })).toBeInTheDocument());
    expect(within(dialog).getByText('1 of 1 people')).toBeVisible();
    expect(within(dialog).queryByRole('option', { name: 'Alice' })).not.toBeInTheDocument();
  });
});
