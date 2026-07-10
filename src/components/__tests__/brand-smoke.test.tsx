// Cherishly-skin tripwire. Lovable's agent edits this repo for Menerio and
// could accidentally unwire the brand switching; these tests fail CI within
// one push if that happens. See docs/BRANDING.md.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHERISHLY } from "@/brands/cherishly";
import { MENERIO } from "@/brands/menerio";

// Force the Cherishly brand for everything rendered in this file.
vi.mock("@/lib/brand", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/brand")>();
  const { CHERISHLY } = await import("@/brands/cherishly");
  return { ...original, BRAND: CHERISHLY };
});

// Sidebar collaborators that need auth/data — irrelevant to nav ordering.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "free", signOut: vi.fn() }),
}));
vi.mock("@/hooks/useProfileSummary", () => ({
  useProfileSummary: () => ({ completeness: 100, entryCount: 0, activeInstructions: 0 }),
}));
vi.mock("@/hooks/useReviewQueue", () => ({
  useReviewQueue: () => ({ pendingCount: 0 }),
}));
vi.mock("@/components/settings/CreditsDisplay", () => ({
  CreditsDisplay: () => null,
}));

describe("Cherishly brand smoke", () => {
  it("landing page renders the Cherishly hero", async () => {
    const { default: CherishlyLanding } = await import("@/pages/CherishlyLanding");
    render(
      <MemoryRouter>
        <CherishlyLanding />
      </MemoryRouter>,
    );
    expect(screen.getByText("Love deserves a little memory magic")).toBeInTheDocument();
    expect(screen.getByText("Cherish a Lovely Person 💕")).toBeInTheDocument();
  });

  it("sidebar puts People before Notes under the Cherishly brand", async () => {
    const { DashboardSidebar } = await import("@/components/layout/DashboardSidebar");
    const { SidebarProvider } = await import("@/components/ui/sidebar");
    render(
      <MemoryRouter>
        <SidebarProvider>
          <DashboardSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    const labels = screen.getAllByText(/^(People|Notes)$/).map((el) => el.textContent);
    expect(labels.indexOf("People")).toBeLessThan(labels.indexOf("Notes"));
    // Docs are hidden on Cherishly (Menerio-branded prose)
    expect(screen.queryByText("Documentation")).not.toBeInTheDocument();
  });

  it("App.tsx keeps the brand-gated landing import", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(appSource).toContain('import("./pages/CherishlyLanding")');
  });

  it("brand configs stay divergent where it matters", () => {
    expect(CHERISHLY.navGroupOrder[0]).toBe("people");
    expect(MENERIO.navGroupOrder[0]).toBe("notes");
    expect(CHERISHLY.dashboardVariant).toBe("people-first");
    expect(CHERISHLY.themeClass).toBe("brand-cherishly");
    expect(CHERISHLY.defaultTheme).toBe("light");
    expect(CHERISHLY.personaName).toBe("Claire");
  });
});
