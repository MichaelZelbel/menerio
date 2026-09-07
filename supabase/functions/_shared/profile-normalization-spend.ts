export type NormalizationStage<T = any> = { result: T; finish: () => Promise<void>; assertLease: () => Promise<void> };

export async function evaluateNormalizationStage<T>(args: {
  db: any; userId: string; contactId: string | null; input: unknown;
  manual?: boolean; evaluate: () => Promise<T>;
}): Promise<NormalizationStage<T>> {
  const fingerprint = await normalizationFingerprint(args.input);
  const scope = { p_user_id: args.userId, p_contact_id: args.contactId, p_fingerprint: fingerprint };
  const { data: claim, error } = await args.db.rpc("claim_profile_normalization_input", { ...scope, p_manual: args.manual === true });
  if (error) throw error;
  if (!claim?.lease_id) throw new Error("NORMALIZATION_BUSY_OR_RETRY_LIMIT");
  const leased = { ...scope, p_lease_id: claim.lease_id };
  const checked = async (name: string, extra = {}) => {
    const { data, error } = await args.db.rpc(name, { ...leased, ...extra });
    if (error) throw error;
    if (data !== true) throw new Error("NORMALIZATION_LEASE_LOST");
  };
  let result = claim.result as T;
  if (!claim.cached) {
    try {
      result = await args.evaluate();
    } catch (error) {
      if (error instanceof Error && ["INSUFFICIENT_CREDITS", "BALANCE_UNAVAILABLE"].includes(error.message)) {
        await checked("defer_profile_normalization_input");
      }
      throw error;
    }
    // Failure here intentionally leaves a lease/attempt diagnostic, not success.
    await checked("stage_profile_normalization_input", { p_result: result });
  }
  return {
    result,
    finish: () => checked("finish_profile_normalization_input"),
    assertLease: () => checked("check_profile_normalization_input"),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function normalizationFingerprint(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(input))));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
