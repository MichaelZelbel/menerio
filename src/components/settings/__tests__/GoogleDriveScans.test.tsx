import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GoogleDriveScans } from "../GoogleDriveScans";

type Answer = { data: unknown; error: unknown };
const answers: Record<string, Answer> = {};

// What supabase.functions.invoke returns for a non-2xx answer: a generic
// message, and the function's own answer in `context`.
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status }),
  });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, { body }: { body: { action: string } }) =>
        answers[body.action] ?? { data: null, error: httpError(500, { error: "unexpected" }) },
    },
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return query;
    },
  },
}));

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  showToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn() },
}));

const realOpen = window.open;

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key];
  toastError.mockReset();
});

afterEach(() => {
  window.open = realOpen;
});

describe("GoogleDriveScans", () => {
  it("says it could not check the connection when the status call fails, instead of 'Not connected'", async () => {
    answers.status = { data: null, error: httpError(500, { error: "boom" }) };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GoogleDriveScans />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check whether Google Drive is connected.");
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();

    answers.status = { data: { connection: null }, error: null };
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("button", { name: /Connect Google Drive/ })).toBeEnabled();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    logged.mockRestore();
  });

  it("frees the Connect button when the Google window is closed without finishing", async () => {
    answers.status = { data: { connection: null }, error: null };
    answers.start_auth = { data: { authorization_url: "https://accounts.example/auth" }, error: null };
    const popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup as unknown as Window);

    render(<GoogleDriveScans />);
    const connect = await screen.findByRole("button", { name: /Connect Google Drive/ });
    fireEvent.click(connect);
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(connect).toBeDisabled();

    popup.closed = true;
    await waitFor(() => expect(connect).toBeEnabled(), { timeout: 2000 });
  });

  it("shows a sentence, never the invoke error's own message or database text", async () => {
    answers.status = { data: { connection: null }, error: null };
    answers.start_auth = {
      data: null,
      error: httpError(500, { error: 'duplicate key value violates unique constraint "gdrive_connections_user_id_key"' }),
    };
    render(<GoogleDriveScans />);
    fireEvent.click(await screen.findByRole("button", { name: /Connect Google Drive/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("Could not start the Google sign-in. Try again.");
  });

  it("names a refused Google consent in words", async () => {
    answers.status = { data: { connection: null }, error: null };
    render(<GoogleDriveScans />);
    await screen.findByRole("button", { name: /Connect Google Drive/ });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "gdrive-oauth", error: "access_denied" },
        }),
      );
    });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Google Drive was not connected, because access was not granted."),
    );
  });
});
