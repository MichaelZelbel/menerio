import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectedGodspeedsCard } from "../ConnectedGodspeedsCard";
import { BRAND } from "@/lib/brand";

let rows: unknown[] = [];
const filters: Array<[string, unknown]> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        order: async () => ({ data: rows, error: null }),
      };
      return query;
    },
  },
}));

const disconnect = vi.fn();
vi.mock("@/lib/mc-connect", () => ({
  disconnectGodspeed: (...args: unknown[]) => disconnect(...args),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

beforeEach(() => {
  rows = [];
  filters.length = 0;
  disconnect.mockReset();
});

describe("ConnectedGodspeedsCard", () => {
  it("explains, with no mission control connected, that the connection starts from Mission Control", async () => {
    render(<ConnectedGodspeedsCard />);
    expect(await screen.findByText(
      `No mission control is connected. The connection starts from Mission Control, because a web page cannot reach a folder on your computer: tell your mission control assistant "connect ${BRAND.name}".`,
    )).toBeInTheDocument();
    expect(filters).toContainEqual(["status", "active"]);
  });

  it("lists each mission control with its computers, their last contact and what each assistant reported", async () => {
    rows = [{
      id: "conn-1", godspeed_name: "Home godspeed", approved_at: minutesAgo(60 * 24 * 3),
      godspeed_devices: [
        { device_id: "d-1", name: "Laptop", last_contact_at: minutesAgo(5), clients: { "claude-code": { state: "working", at: minutesAgo(5) }, codex: { state: "waiting", at: minutesAgo(9) } } },
        { device_id: "d-2", name: "VPS", last_contact_at: minutesAgo(120), clients: { hermes: { state: "failed", at: minutesAgo(120) } } },
      ],
    }];
    render(<ConnectedGodspeedsCard />);
    expect(await screen.findByText("Home godspeed")).toBeInTheDocument();
    expect(screen.getByText("Connected 3 days ago")).toBeInTheDocument();
    expect(screen.getByText(/last contact 5 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText(/last contact about 2 hours ago/)).toBeInTheDocument();
    expect(screen.getByText("claude-code: Working")).toBeInTheDocument();
    expect(screen.getByText("codex: Waiting for restart")).toBeInTheDocument();
    expect(screen.getByText("hermes: Failed")).toBeInTheDocument();
  });

  it("asks before disconnecting, in the agreed words, and then ends that connection", async () => {
    rows = [{ id: "conn-1", godspeed_name: "Home godspeed", approved_at: minutesAgo(10), godspeed_devices: [] }];
    disconnect.mockResolvedValue({ ok: true, data: { status: "disconnected" }, status: 200, code: "", message: "" });
    render(<ConnectedGodspeedsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(
      `Disconnect ${BRAND.name} from this mission control? Every assistant of this mission control loses access on its next request. Your original mission control files and your own ${BRAND.name} notes will stay.`,
    )).toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();

    rows = [];
    const buttons = screen.getAllByRole("button", { name: "Disconnect" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("conn-1"));
    expect(await screen.findByText(/No mission control is connected/)).toBeInTheDocument();
  });
});
