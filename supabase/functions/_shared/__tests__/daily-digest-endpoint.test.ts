import { describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint, postJson } from "./edge-harness";

describe("daily-digest", () => {
  it("asks for overdue contacts an assistant may see before their names reach the prompt", async () => {
    const db = fakeDb((q) => {
      if (q.table === "contacts") return { data: [{ name: "Visible Friend", last_contact_date: "2026-01-01", contact_frequency_days: 7 }] };
      if (q.table === "profiles") return { data: { display_name: "Fixture" } };
      return { data: [] };
    });
    const client = { ...db.client, auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.invalid", user_metadata: {} } } }) } } };
    const runChat = vi.fn(async () => ({ content: JSON.stringify({ bullets: ["Call Visible Friend"] }) }));
    const handler = loadEndpoint("supabase/functions/daily-digest/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => client },
      "../_shared/llm-router.ts": { parseModelJson: (raw: string) => JSON.parse(raw), runChat, sourceLanguageRule: () => "" },
      "../_shared/llm-defaults.ts": { DAILY_DIGEST_PROMPT: "fixture" },
    }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" });

    const res = await handler(postJson("https://fixture.invalid/daily-digest", { user_id: "user-a" }, "fixture-service"));
    expect(res.status).toBe(200);
    expect(runChat).toHaveBeenCalledTimes(1);

    const contactReads = db.on("contacts");
    expect(contactReads.length).toBeGreaterThanOrEqual(2);
    for (const q of contactReads) {
      expect(q.has("eq", "user_id", "user-a")).toBe(true);
      expect(q.has("is", "merged_into", null)).toBe(true);
    }
    // The read whose names go to the model: visible and not sensitive too.
    const promptRead = contactReads.find((q) => q.has("select", "name, last_contact_date, contact_frequency_days"))!;
    expect(promptRead.has("eq", "ai_visibility", "visible")).toBe(true);
    expect(promptRead.has("or", "is_sensitive.is.null,is_sensitive.eq.false")).toBe(true);
  });

  it("refuses a caller without the service key", async () => {
    const db = fakeDb();
    const handler = loadEndpoint("supabase/functions/daily-digest/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
      "../_shared/llm-router.ts": { parseModelJson: vi.fn(), runChat: vi.fn(), sourceLanguageRule: () => "" },
      "../_shared/llm-defaults.ts": { DAILY_DIGEST_PROMPT: "fixture" },
    }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" });
    const res = await handler(postJson("https://fixture.invalid/daily-digest", { user_id: "user-b" }, "a-user-jwt"));
    expect(res.status).toBe(401);
    expect(db.queries).toHaveLength(0);
  });
});
