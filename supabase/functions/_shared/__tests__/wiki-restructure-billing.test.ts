import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute the real endpoint with explicit authentication/database/provider fixtures.
// No remote database or provider is contacted.
async function fixture() {
  let handler!: (request: Request) => Promise<Response>;
  const background: Promise<unknown>[] = [];
  const owner = "11111111-1111-4111-8111-111111111111";
  const page = { id: "page-fixture", user_id: owner, slug: "fixture", title: "Fixture", content: "Synthetic raw content", protected_sections: [] };
  const dataTables: string[] = [];
  const dataClient = {
    from: (table: string) => {
      dataTables.push(table);
      let reading = false;
      const query: any = new Proxy({}, { get: (_target, key) => {
        if (key === "then") return (resolve: any, reject: any) => Promise.resolve({ data: reading ? [page] : null, error: null }).then(resolve, reject);
        return () => { if (key === "select") reading = true; return query; };
      } });
      return query;
    },
  };
  const events: Record<string, unknown>[] = [];
  let balance = 100;
  const billingClient = {
    from: vi.fn(() => { throw new Error("Page data must remain protected by user RLS"); }),
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      events.push(args); balance -= 20;
      return { data: { allowed: true, remaining_tokens: balance }, error: null };
    }),
  };
  const runChat = vi.fn(async (args: any) => {
    if (args.db !== billingClient) throw new Error("42501: attributed deduction requires service role");
    await args.db.rpc("deduct_ai_tokens_attributed", { p_user_id: args.userId, p_feature: args.callSite });
    return { content: JSON.stringify({ content: "Synthetic formatted content" }) };
  });
  const createClient = vi.fn((_url: string, key: string, options?: unknown) => key === "fixture-service"
    ? billingClient : options ? dataClient : { auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } });
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.224.0/http/server.ts": { serve: (fn: typeof handler) => { handler = fn; } },
    "https://esm.sh/@supabase/supabase-js@2": { createClient },
    "../_shared/cron-auth.ts": { isValidCronRequest: async () => false },
    "../_shared/llm-router.ts": { runChat },
    "../_shared/llm-defaults.ts": { WIKI_RESTRUCTURE_PROMPT: "Fixture prompt" },
    "../_shared/wiki-structure.ts": {
      analyzeStructure: () => ({ chars: 20, headingCount: 0, maxParagraphWords: 5, maxSectionWords: 5 }),
      chunkMarkdown: (text: string) => [text], missingFacts: () => [],
      needsRestructure: () => true, softStructure: (text: string) => text,
    },
  };
  const source = readFileSync("supabase/functions/wiki-restructure/index.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "Deno", "EdgeRuntime", "exports", output)(
    (name: string) => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; },
    { env: { get: (name: string) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture-public", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" }[name]) } },
    { waitUntil: (promise: Promise<unknown>) => background.push(promise) }, {},
  );
  const response = await handler(new Request("https://fixture.invalid/wiki-restructure", {
    method: "POST", headers: { Authorization: "Bearer fixture-user", "Content-Type": "application/json" },
    body: JSON.stringify({ slugs: ["fixture"], user_id: "untrusted-other-account" }),
  }));
  await Promise.all(background);
  return { response, owner, runChat, billingClient, events, balance, dataTables };
}

describe("authenticated Lexicon restructure billing", () => {
  it("uses service billing for the verified page owner while retaining user-RLS page access", async () => {
    const f = await fixture();
    expect(f.response.status).toBe(202);
    expect(f.runChat).toHaveBeenCalledTimes(1);
    expect(f.runChat.mock.calls[0][0].db).toBe(f.billingClient);
    expect(f.runChat.mock.calls[0][0].userId).toBe(f.owner);
    expect(f.events).toEqual([{ p_user_id: f.owner, p_feature: "wiki-restructure.main" }]);
    expect(f.balance).toBe(80);
    expect(f.dataTables).toContain("wiki_pages");
    expect(f.dataTables).toContain("wiki_revisions");
    expect(f.billingClient.from).not.toHaveBeenCalled();
  });
});
