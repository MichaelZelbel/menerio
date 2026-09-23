import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// By-name icon chunks are not precached by the service worker, so offline the
// import fails. The icon must fall back to a circle, not throw to the error
// boundary and take the profile page down.
vi.mock("lucide-react/dynamicIconImports", () => ({
  default: { "offline-icon": () => Promise.reject(new Error("Failed to fetch dynamically imported module")) },
}));
import { ProfileIcon } from "../ProfileIcon";

describe("ProfileIcon", () => {
  it("draws the fallback circle when the icon chunk cannot be loaded", async () => {
    const { container } = render(<ProfileIcon name="offline-icon" data-testid="icon" />);
    await waitFor(() => expect(container.querySelector("svg.lucide-circle")).not.toBeNull());
  });

  it("draws the circle for a name lucide does not have", () => {
    const { container } = render(<ProfileIcon name="no-such-icon" />);
    expect(container.querySelector("svg.lucide-circle")).not.toBeNull();
  });
});
