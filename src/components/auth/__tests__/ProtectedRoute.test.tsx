import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProtectedRoute } from "../ProtectedRoute";
import { peekReturnTo, rememberReturnTo, safeReturnPath } from "@/lib/return-to";

const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<Where />} />
        <Route path="/connect-hub" element={<ProtectedRoute><Where /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Where /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
}

const LINK = "/connect-hub?request=7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11&code=BCDF-GHJK";

beforeEach(() => {
  useAuthMock.mockReset();
  sessionStorage.clear();
});

describe("ProtectedRoute", () => {
  it("sends an anonymous visitor to sign in with the whole URL to come back to, query string included", () => {
    useAuthMock.mockReturnValue({ session: null, loading: false });
    renderAt(LINK);
    expect(screen.getByTestId("where").textContent).toBe(`/auth?redirect=${encodeURIComponent(LINK)}`);
  });

  it("shows the page to a signed-in visitor, query string untouched", () => {
    useAuthMock.mockReturnValue({ session: { user: { id: "u" } }, loading: false });
    renderAt(LINK);
    expect(screen.getByTestId("where").textContent).toBe(LINK);
  });

  it("finishes the trip after a Google or GitHub sign-in that came back to the dashboard, once", () => {
    useAuthMock.mockReturnValue({ session: { user: { id: "u" } }, loading: false });
    rememberReturnTo(LINK);
    renderAt("/dashboard");
    expect(screen.getByTestId("where").textContent).toBe(LINK);
    expect(peekReturnTo()).toBeNull();
  });

  it("does not move anybody while the session is still loading", () => {
    useAuthMock.mockReturnValue({ session: null, loading: true });
    rememberReturnTo(LINK);
    renderAt("/dashboard");
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
    expect(peekReturnTo()).toBe(LINK);
  });
});

describe("safeReturnPath", () => {
  it("accepts a path inside the app and nothing that leaves it", () => {
    expect(safeReturnPath(LINK)).toBe(LINK);
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil.example", "dashboard", "/auth", "/auth?redirect=/auth", null, 7]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
});
