import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Proof that professional/service roles never render inside the personal
 * "Relationships" card — they get their own, separately collapsible card
 * that is collapsed by default.
 */

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ order: async () => ({ data: [] }) }),
          single: async () => ({ data: { display_name: "Michael" } }),
        }),
        in: async () => ({ data: [] }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useContactRelationships", () => ({
  useContactRelationships: () => ({
    relationships: [
      {
        id: "r1",
        label: "spouse",
        custom_label: null,
        source_type: "self",
        source_id: null,
        target_type: "contact",
        target_id: "c-xihui",
        target_contact: { name: "Xihui" },
        source_contact: null,
      },
      {
        id: "r2",
        label: "manager",
        custom_label: null,
        source_type: "contact",
        source_id: "c-gunther",
        target_type: "self",
        target_id: null,
        source_contact: { name: "Gunther Reinhard" },
        target_contact: null,
      },
    ],
    isLoading: false,
    upsertRelationship: { mutate: vi.fn(), isPending: false },
    deleteRelationship: { mutate: vi.fn() },
  }),
}));

import { RelationshipsSection } from "@/components/people/RelationshipsSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RelationshipsSection contactId={null} contactName="My" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("relationship role separation", () => {
  it("keeps professional roles out of the Relationships card", () => {
    const { container } = renderSection();

    const cards = Array.from(container.querySelectorAll("div.rounded-lg.border"));
    expect(cards.length).toBe(2);

    const personalCard = cards.find((c) => c.textContent?.includes("Relationships"))!;
    const proCard = cards.find((c) =>
      c.textContent?.includes("Professional & service contacts"),
    )!;
    expect(personalCard).toBeTruthy();
    expect(proCard).toBeTruthy();
    expect(personalCard).not.toBe(proCard);

    // Personal card shows the spouse and NOT the manager.
    expect(personalCard.textContent).toContain("Xihui");
    expect(personalCard.textContent).not.toContain("Gunther");
    expect(personalCard.textContent?.toLowerCase()).not.toContain("manager");

    // Professional card is collapsed by default: header only, no rows.
    expect(proCard.textContent).not.toContain("Gunther");
  });

  it("reveals professional contacts only after expanding their own section", async () => {
    const { container } = renderSection();
    const proToggle = Array.from(container.querySelectorAll("button")).find((b) =>
      b.parentElement?.textContent?.includes("Professional & service contacts"),
    )!;
    proToggle.click();
    expect(await screen.findByText("Gunther Reinhard")).toBeTruthy();
  });
});
