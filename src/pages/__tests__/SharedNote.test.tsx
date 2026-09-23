import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "anon",
}));
vi.mock("@/components/legal/CookieSettingsButton", () => ({ CookieSettingsButton: () => null }));

import SharedNote from "@/pages/SharedNote";
import { BRAND } from "@/lib/brand";

function renderAt(token = "abc") {
  return render(
    <MemoryRouter initialEntries={[`/shared/${token}`]}>
      <Routes>
        <Route path="/shared/:token" element={<SharedNote />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("SharedNote", () => {
  it("says the note is gone when the server answers 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Note not found" }), { status: 404 })));
    renderAt();
    expect(await screen.findByRole("heading", { name: "Note not found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not claim the note is gone when the request itself failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt();
    expect(await screen.findByRole("heading", { name: "This note could not be loaded" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("names the active brand and titles an untitled note", async () => {
    const body = { title: "", content: "Hello", tags: null, entity_type: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    renderAt();
    expect(await screen.findByRole("heading", { name: "Untitled" })).toBeInTheDocument();
    expect(screen.getByText(BRAND.name)).toBeInTheDocument();
  });
});
