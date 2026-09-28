import { describe, expect, it } from "vitest";
import { functionsToDeploy } from "../../../scripts/golive/functions-to-deploy.mjs";

// The go-live must redeploy every function that bundles a changed _shared
// module, not only the folders a diff names (eleventh review).
describe("functionsToDeploy", () => {
  it("includes functions whose own folder is unchanged but whose bundle holds a changed shared module", () => {
    const deploy = functionsToDeploy("supabase/functions", ["supabase/functions/_shared/people-sync-core.ts"]);
    expect(deploy).toEqual(expect.arrayContaining(["github-people-sync", "github-sync-pull", "github-sync-scheduled"]));
  });

  it("follows imports through other shared modules", () => {
    const deploy = functionsToDeploy("supabase/functions", ["supabase/functions/_shared/user-profile.ts"]);
    expect(deploy).toContain("collection-chat");
  });

  it("puts menerio-mcp last and leaves unrelated functions out", () => {
    const deploy = functionsToDeploy("supabase/functions", [
      "supabase/functions/menerio-mcp/index.ts",
      "supabase/functions/normalize-profile/index.ts",
    ]);
    expect(deploy.at(-1)).toBe("menerio-mcp");
    expect(deploy).toContain("normalize-profile");
    expect(deploy).not.toContain("github-people-sync");
  });
});
