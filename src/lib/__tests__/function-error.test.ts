import { describe, expect, it } from "vitest";
import {
  OFFLINE_MESSAGE,
  OUT_OF_CREDITS_MESSAGE,
  dbErrorMessage,
  functionErrorMessage,
  isNetworkError,
  readFunctionError,
} from "../function-error";

// What supabase-js hands back for a non-2xx function answer.
function httpError(status: number, body: unknown) {
  const err = new Error("Edge Function returned a non-2xx status code") as Error & { context: Response };
  err.name = "FunctionsHttpError";
  err.context = new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  return err;
}

describe("function-error", () => {
  it("reads the status, code and message a function sent", async () => {
    const details = await readFunctionError(httpError(402, { error: "Insufficient AI credits", code: "INSUFFICIENT_CREDITS" }));
    expect(details).toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS", message: "Insufficient AI credits" });
  });

  it("leaves the body readable for a caller that reads it afterwards", async () => {
    const err = httpError(403, { error: "Invalid password" });
    await readFunctionError(err);
    expect(await err.context.json()).toEqual({ error: "Invalid password" });
  });

  it("names an empty allowance instead of the generic non-2xx text", async () => {
    expect(await functionErrorMessage(httpError(402, { error: "Insufficient AI credits" }), "fallback")).toBe(OUT_OF_CREDITS_MESSAGE);
  });

  it("shows a function's own sentence, such as a wrong password", async () => {
    expect(await functionErrorMessage(httpError(403, { error: "Invalid password" }), "fallback")).toBe("Invalid password");
  });

  it("never shows database or runtime internals", async () => {
    const err = httpError(500, { error: 'new row for relation "user_mcp_servers" violates check constraint "user_mcp_servers_name_length"' });
    expect(await functionErrorMessage(err, "Could not save the server.")).toBe("Could not save the server.");
    expect(await functionErrorMessage(new Error("Edge Function returned a non-2xx status code"), "Could not load.")).toBe("Could not load.");
  });

  it("says the server could not be reached when there was no answer", async () => {
    const offline = new Error("Failed to send a request to the Edge Function");
    offline.name = "FunctionsFetchError";
    expect(isNetworkError(offline)).toBe(true);
    expect(await functionErrorMessage(offline, "fallback")).toBe(OFFLINE_MESSAGE);
    expect(dbErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe(OFFLINE_MESSAGE);
  });

  it("uses the fallback for database errors", () => {
    expect(dbErrorMessage({ message: "JWT expired", code: "PGRST301" }, "Could not save.")).toBe("Could not save.");
  });
});
