import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AdminRoute } from "../AdminRoute";

// Mock useAuth so we can drive role/loading/roleLoading deterministically.
const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/dashboard/admin"
          element={
            <AdminRoute>
              <div>ADMIN_CONTENT</div>
            </AdminRoute>
          }
        />
        <Route path="/dashboard" element={<div>DASHBOARD_HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe("AdminRoute", () => {
  it("shows the loading skeleton and does NOT redirect while role is still hydrating (regression)", () => {
    // The bug: previously this state caused an immediate redirect to /dashboard
    // for real admins because loading flipped to false before the role fetch
    // resolved.
    useAuthMock.mockReturnValue({
      role: null,
      loading: false,
      roleLoading: true,
    });

    renderAt("/dashboard/admin");

    expect(screen.queryByText("DASHBOARD_HOME")).not.toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
  });

  it("renders the admin content when role resolves to admin", () => {
    useAuthMock.mockReturnValue({
      role: "admin",
      loading: false,
      roleLoading: false,
    });

    renderAt("/dashboard/admin");

    expect(screen.getByText("ADMIN_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD_HOME")).not.toBeInTheDocument();
  });

  it("redirects to /dashboard when role resolves to a non-admin role", async () => {
    useAuthMock.mockReturnValue({
      role: "free",
      loading: false,
      roleLoading: false,
    });

    renderAt("/dashboard/admin");

    expect(await screen.findByText("DASHBOARD_HOME")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton when the session itself is still loading", () => {
    useAuthMock.mockReturnValue({
      role: null,
      loading: true,
      roleLoading: true,
    });

    renderAt("/dashboard/admin");

    expect(screen.queryByText("DASHBOARD_HOME")).not.toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
  });

  it("renders admin content after role transitions from loading to admin (no intervening redirect)", () => {
    useAuthMock.mockReturnValue({
      role: null,
      loading: false,
      roleLoading: true,
    });

    const { rerender } = renderAt("/dashboard/admin");

    expect(screen.queryByText("DASHBOARD_HOME")).not.toBeInTheDocument();

    useAuthMock.mockReturnValue({
      role: "admin",
      loading: false,
      roleLoading: false,
    });

    rerender(
      <MemoryRouter initialEntries={["/dashboard/admin"]}>
        <Routes>
          <Route
            path="/dashboard/admin"
            element={
              <AdminRoute>
                <div>ADMIN_CONTENT</div>
              </AdminRoute>
            }
          />
          <Route path="/dashboard" element={<div>DASHBOARD_HOME</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("ADMIN_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD_HOME")).not.toBeInTheDocument();
  });
});
