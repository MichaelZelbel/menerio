import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectedHubsCard } from "../ConnectedHubsCard";
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
vi.mock("@/lib/hub-connect", () => ({
  disconnectHub: (...args: unknown[]) => disconnect(...args),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

beforeEach(() => {
  rows = [];
  filters.length = 0;
  disconnect.mockReset();
});

describe("ConnectedHubsCard", () => {
  it("explains, with no hub connected, that the connection starts from the hub", async () => {
    render(<ConnectedHubsCard />);
    expect(await screen.findByText(
      `No hub is connected. The connection starts from the hub, because a web page cannot reach a folder on your computer: tell your hub assistant "connect ${BRAND.name}".`,
    )).toBeInTheDocument();
    expect(filters).toContainEqual(["status", "active"]);
  });

  it("lists each hub with its computers, their last contact and what each assistant reported", async () => {
    rows = [{
      id: "conn-1", hub_name: "Home hub", approved_at: minutesAgo(60 * 24 * 3),
      hub_devices: [
        { device_id: "d-1", name: "Laptop", last_contact_at: minutesAgo(5), clients: { "claude-code": { state: "working", at: minutesAgo(5) }, codex: { state: "waiting", at: minutesAgo(9) } } },
        { device_id: "d-2", name: "VPS", last_contact_at: minutesAgo(120), clients: { hermes: { state: "failed", at: minutesAgo(120) } } },
      ],
    }];
    render(<ConnectedHubsCard />);
    expect(await screen.findByText("Home hub")).toBeInTheDocument();
    expect(screen.getByText("Connected 3 days ago")).toBeInTheDocument();
    expect(screen.getByText(/last contact 5 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText(/last contact about 2 hours ago/)).toBeInTheDocument();
    expect(screen.getByText("claude-code: Working")).toBeInTheDocument();
    expect(screen.getByText("codex: Waiting for restart")).toBeInTheDocument();
    expect(screen.getByText("hermes: Failed")).toBeInTheDocument();
  });

  it("asks before disconnecting, in the agreed words, and then ends that connection", async () => {
    rows = [{ id: "conn-1", hub_name: "Home hub", approved_at: minutesAgo(10), hub_devices: [] }];
    disconnect.mockResolvedValue({ ok: true, data: { status: "disconnected" }, status: 200, code: "", message: "" });
    render(<ConnectedHubsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(
      `Disconnect ${BRAND.name} from this hub? Every assistant of this hub loses access on its next request. Your original hub files and your own ${BRAND.name} notes will stay.`,
    )).toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();

    rows = [];
    const buttons = screen.getAllByRole("button", { name: "Disconnect" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("conn-1"));
    expect(await screen.findByText(/No hub is connected/)).toBeInTheDocument();
  });
});
