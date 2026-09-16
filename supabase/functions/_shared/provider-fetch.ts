/**
 * The one outbound fetch every paid model call goes through.
 *
 * Until 2026-09-16 no provider call carried a timeout. A provider that accepted
 * the request and never answered held the executor until the platform killed
 * the isolate, so the job's lease simply ran out with no error recorded and no
 * way to tell a hung provider from a crash.
 *
 * 150 s, not less: `deepseek-v4-flash` counts its reasoning as completion
 * tokens, the reasoning sites are capped at 8,000, and at the ~60 tokens a
 * second seen on that model a full reply takes about 133 s. It stays under the
 * five-minute job lease and the edge runtime's wall clock, so a hung call now
 * fails inside the executor where the stage protocol can see it.
 *
 * A timeout is thrown as a plain Error that names the provider. Inside a paid
 * stage it becomes `uncertain` like any other provider failure (the request
 * reached the provider and may have been billed, so it must not be re-bought
 * blindly); outside one, `classifyNoteAIError` reads it as `transient`.
 */
export const PROVIDER_TIMEOUT_MS = 150_000;

export class ProviderTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "ProviderTimeoutError";
  }
}

export async function providerFetch(
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "TimeoutError") throw new ProviderTimeoutError(label, timeoutMs);
    throw error;
  }
}
