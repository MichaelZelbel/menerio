import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConnectGodspeed from "../ConnectGodspeed";
import { BRAND } from "@/lib/brand";

const getRequest = vi.fn();
const answerRequest = vi.fn();
vi.mock("@/lib/mc-connect", () => ({
  getConnectRequest: (...args: unknown[]) => getRequest(...args),
  answerConnectRequest: (...args: unknown[]) => answerRequest(...args),
}));

const REQUEST_ID = "7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11";
const open = {
  ok: true, status: 200, code: "", message: "",
  data: {
    godspeed_name: "Home godspeed", device_name: "Laptop", flow: "browser", wants: { context: true, documents: false },
    user_code: "BCDF-GHJK", status: "pending", expires_at: "2026-09-20T18:10:00Z",
    account_label: "person@example.test", reconnect: false,
  },
};
const answered = (status: "approved" | "denied") => ({ ok: true, status: 200, code: "", message: "", data: { status } });
const refusal = (status: number, code: string, extra = {}) => ({ ok: false, data: null, status, code, message: "Server said no.", ...extra });

const renderAt = (search: string) =>
  render(<MemoryRouter initialEntries={[`/connect-godspeed${search}`]}><ConnectGodspeed /></MemoryRouter>);

beforeEach(() => {
  getRequest.mockReset();
  answerRequest.mockReset();
});

describe("ConnectGodspeed", () => {
  it("shows the account, Mission Control, the computer, the code to compare, and what connecting allows", async () => {
    getRequest.mockResolvedValue(open);
    renderAt(`?request=${REQUEST_ID}&code=BCDF-GHJK`);
    expect(await screen.findByText("Connect this mission control?")).toBeInTheDocument();
    expect(getRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(screen.getByText("person@example.test")).toBeInTheDocument();
    expect(screen.getByText("Home godspeed")).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByTestId("user-code").textContent).toBe("BCDF-GHJK");
    expect(screen.getByText(`Your mission control's assistants can read your profile, people, notes and facts in ${BRAND.name}, and save notes for you.`)).toBeInTheDocument();
    expect(screen.getByText("No files from your mission control are copied.")).toBeInTheDocument();
  });

  it("approves with the code from the link and then says it is done", async () => {
    getRequest.mockResolvedValue(open);
    answerRequest.mockResolvedValue(answered("approved"));
    renderAt(`?request=${REQUEST_ID}&code=BCDF-GHJK`);
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected. You can close this page.")).toBeInTheDocument();
    expect(answerRequest).toHaveBeenCalledWith(REQUEST_ID, "BCDF-GHJK", true);
  });

  it("says nothing was connected after a no", async () => {
    getRequest.mockResolvedValue(open);
    answerRequest.mockResolvedValue(answered("denied"));
    renderAt(`?request=${REQUEST_ID}&code=BCDF-GHJK`);
    fireEvent.click(await screen.findByRole("button", { name: "Don't connect" }));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(answerRequest).toHaveBeenCalledWith(REQUEST_ID, "BCDF-GHJK", false);
  });

  it("asks for the code when the link has none, and again when it was wrong", async () => {
    getRequest.mockResolvedValue(open);
    answerRequest.mockResolvedValue(refusal(400, "wrong_code", { attemptsLeft: 4 }));
    renderAt(`?request=${REQUEST_ID}`);
    const input = await screen.findByLabelText("Type the code your mission control shows");
    expect(screen.queryByTestId("user-code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "zzzz-zzzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code does not match. 4 tries left.");
    expect(answerRequest).toHaveBeenCalledWith(REQUEST_ID, "ZZZZ-ZZZZ", true);
  });

  it("says the request was closed when the last wrong code denied it", async () => {
    getRequest.mockResolvedValue(open);
    answerRequest.mockResolvedValue(answered("denied"));
    renderAt(`?request=${REQUEST_ID}&code=BCDF-GHJK`);
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Too many wrong codes")).toBeInTheDocument();
  });

  it("tells a returning mission control that earlier access stops working", async () => {
    getRequest.mockResolvedValue({ ...open, data: { ...open.data, reconnect: true } });
    renderAt(`?request=${REQUEST_ID}&code=BCDF-GHJK`);
    expect(await screen.findByText("Connect this mission control again?")).toBeInTheDocument();
  });

  it("says the request is not open for a 404, and does not ask the server without a request", async () => {
    getRequest.mockResolvedValue(refusal(404, "not_found"));
    const first = renderAt(`?request=${REQUEST_ID}`);
    expect(await screen.findByText("This request is not open")).toBeInTheDocument();
    expect(screen.getByText(/Start again from your mission control/)).toBeInTheDocument();
    first.unmount();

    getRequest.mockClear();
    renderAt("");
    expect(await screen.findByText(/This page opens from your mission control/)).toBeInTheDocument();
    expect(getRequest).not.toHaveBeenCalled();
  });

  it("shows the server's sentence for any other failure", async () => {
    getRequest.mockResolvedValue(refusal(500, "server_error"));
    renderAt(`?request=${REQUEST_ID}`);
    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
    expect(screen.getByText("Server said no.")).toBeInTheDocument();
  });
});
