import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USER_STORAGE_BUCKETS } from "../../../supabase/functions/_shared/delete-user-storage";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("profile pictures are gone", () => {
  it("no app code touches the avatars bucket or the avatar_url column", () => {
    const offenders = files("src")
      .filter((f) => {
        const normalized = f.replace(/\\/g, "/");
        return !normalized.includes("integrations/supabase/types.ts") && !normalized.includes("__tests__");
      })
      .filter((f) => /from\("avatars"\)|avatar_url|avatar-url/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("account deletion no longer lists the avatars bucket", () => {
    expect([...USER_STORAGE_BUCKETS]).toEqual(["note-attachments"]);
  });
});
