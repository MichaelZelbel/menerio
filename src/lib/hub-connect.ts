import { supabase } from "@/integrations/supabase/client";

/**
 * The browser's side of the hub-connect edge function: the approval page reads
 * and answers a request, Settings ends a connection. The hub itself talks to
 * the other routes and never goes through here.
 */

export interface HubConnectRequest {
  hub_name: string;
  device_name: string;
  flow: "browser" | "device";
  wants: { context?: boolean; documents?: boolean };
  user_code: string;
  status: string;
  expires_at: string;
  account_label: string;
  reconnect: boolean;
}

/**
 * One shape for both outcomes rather than a union: this project compiles
 * without strictNullChecks, where `if (!res.ok)` does not narrow a union.
 */
export interface HubConnectResult<T> {
  ok: boolean;
  /** The answer when ok, otherwise null. */
  data: T | null;
  status: number;
  /** The function's error code (`not_found`, `wrong_code`, ...), empty when ok. */
  code: string;
  message: string;
  attemptsLeft?: number;
}

/**
 * One call to hub-connect as the signed-in person.
 *
 * functions.invoke reports a non-2xx answer as an error whose `context` is the
 * Response. The page needs what is inside it: 404 (not open any more) and 400
 * wrong_code (try again) are ordinary answers here, not failures.
 */
export async function callHubConnect<T>(
  route: string,
  options: { method: "GET" | "POST"; body?: Record<string, unknown> },
): Promise<HubConnectResult<T>> {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke(`hub-connect/${route}`, {
    method: options.method,
    headers: { Authorization: `Bearer ${session?.access_token}` },
    ...(options.body ? { body: options.body } : {}),
  });
  if (!error) return { ok: true, data: data as T, status: 200, code: "", message: "" };

  const response = (error as { context?: Response }).context;
  let body: { error?: string; message?: string; attempts_left?: number } = {};
  try {
    body = (await response?.json()) ?? {};
  } catch {
    /* no JSON body: the status and a general sentence will have to do */
  }
  return {
    ok: false,
    data: null,
    status: response?.status ?? 0,
    code: body.error ?? "network",
    message: body.message ?? "Something went wrong. Please try again.",
    attemptsLeft: body.attempts_left,
  };
}

export const getConnectRequest = (requestId: string) =>
  callHubConnect<HubConnectRequest>(`request?request_id=${encodeURIComponent(requestId)}`, { method: "GET" });

export const answerConnectRequest = (requestId: string, userCode: string, approve: boolean) =>
  callHubConnect<{ status: "approved" | "denied" }>("approve", {
    method: "POST",
    body: { request_id: requestId, user_code: userCode, approve, documents: false },
  });

export const disconnectHub = (connectionId: string) =>
  callHubConnect<{ status: "disconnected" }>("disconnect", {
    method: "POST",
    body: { connection_id: connectionId },
  });
