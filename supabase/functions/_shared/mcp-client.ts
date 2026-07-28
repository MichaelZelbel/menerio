/**
 * Outbound MCP client for the chat agents.
 *
 * Loads the current user's configured MCP servers (table `user_mcp_servers`),
 * connects to each over Streamable HTTP, lists their tools, and exposes them as
 * OpenAI-style function tools the agent loop can call. Tool names are
 * namespaced so calls route back to the right server.
 *
 * Guardrails (cost + latency + resilience):
 *  - only runs when the user actually has enabled servers,
 *  - caps servers and total tools,
 *  - connects with a short timeout and SKIPS any server that fails rather than
 *    breaking the chat.
 *
 * The MCP SDK is loaded LAZILY (dynamic import) and ONLY when the user actually
 * has enabled servers. This keeps the SDK — a heavy npm dependency with Node
 * internals — out of the function's boot path entirely, so it can never crash
 * the chat for the common case (no MCP servers). SDK pinned to match the server
 * side (menerio-mcp/deno.json → 1.24.3), loaded via `npm:` like the server.
 */

// Specifiers held as variables so `deno check` doesn't eagerly resolve them
// (the root package.json makes local npm: resolution fail); Supabase's runtime
// resolves `npm:` specifiers natively, as menerio-mcp already relies on.
const CLIENT_SPEC = "npm:@modelcontextprotocol/sdk@1.24.3/client/index.js";
const TRANSPORT_SPEC = "npm:@modelcontextprotocol/sdk@1.24.3/client/streamableHttp.js";

// deno-lint-ignore no-explicit-any
type Any = any;

async function loadSdk(): Promise<{ Client: Any; StreamableHTTPClientTransport: Any }> {
  const [clientMod, transportMod] = await Promise.all([
    import(CLIENT_SPEC),
    import(TRANSPORT_SPEC),
  ]);
  return {
    Client: clientMod.Client,
    StreamableHTTPClientTransport: transportMod.StreamableHTTPClientTransport,
  };
}

const MAX_SERVERS = 5;
const MAX_TOOLS = 15;
const CONNECT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 20000;

interface UserMcpServerRow {
  id: string;
  name: string;
  url: string;
  auth: Record<string, unknown> | null;
  enabled: boolean;
}

export interface LoadedMcpTools {
  /** OpenAI-style tool schemas to advertise to the model (may be empty). */
  tools: any[];
  /** True if `name` is one of the loaded MCP tools. */
  hasTool(name: string): boolean;
  /** Execute an MCP tool call; returns a JSON string for the agent. */
  call(name: string, args: Record<string, unknown>): Promise<string>;
  /** Close all connections. Always call in a finally block. */
  close(): Promise<void>;
}

const EMPTY: LoadedMcpTools = {
  tools: [],
  hasTool: () => false,
  call: async () => JSON.stringify({ error: "no MCP tools loaded" }),
  close: async () => {},
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function sanitize(s: string, max: number): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function headersFor(auth: Record<string, unknown> | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!auth) return headers;
  if (typeof auth.token === "string" && auth.token) {
    headers["Authorization"] = `Bearer ${auth.token}`;
  }
  if (auth.headers && typeof auth.headers === "object") {
    for (const [k, v] of Object.entries(auth.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  return headers;
}

/**
 * Connect to the user's enabled MCP servers and return their tools + a call
 * router. Never throws — connection failures are logged and skipped.
 */
export async function loadUserMcpTools(
  db: any,
  userId: string
): Promise<LoadedMcpTools> {
  let rows: UserMcpServerRow[] = [];
  try {
    const { data, error } = await db
      .from("user_mcp_servers")
      .select("id, name, url, auth, enabled")
      .eq("user_id", userId)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(MAX_SERVERS);
    if (error) {
      // Table may not exist yet in this environment — degrade gracefully.
      console.warn("[mcp-client] load servers failed:", error.message);
      return EMPTY;
    }
    rows = (data || []) as UserMcpServerRow[];
  } catch (err: any) {
    console.warn("[mcp-client] load servers threw:", err?.message);
    return EMPTY;
  }
  if (rows.length === 0) return EMPTY;

  // The user has servers → now (and only now) load the MCP SDK. If it can't be
  // loaded in this runtime, degrade to no MCP tools rather than crash the chat.
  let Client: Any, StreamableHTTPClientTransport: Any;
  try {
    ({ Client, StreamableHTTPClientTransport } = await loadSdk());
  } catch (err: any) {
    console.warn("[mcp-client] MCP SDK failed to load; skipping MCP tools:", err?.message);
    return EMPTY;
  }

  const clients: Any[] = [];
  const tools: any[] = [];
  // namespaced tool name -> { client, originalName }
  const routing = new Map<string, { client: Any; originalName: string }>();
  const usedNames = new Set<string>();

  // Connect + list tools for all servers in parallel; skip failures.
  await Promise.all(
    rows.map(async (row) => {
      let client: Any = null;
      try {
        client = new Client(
          { name: "menerio-chat", version: "1.0.0" },
          { capabilities: {} }
        );
        const transport = new StreamableHTTPClientTransport(new URL(row.url), {
          requestInit: { headers: headersFor(row.auth) },
        });
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect ${row.name}`);
        const listed: any = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `listTools ${row.name}`);
        clients.push(client);

        const serverSlug = sanitize(row.name, 20) || `srv-${row.id.slice(0, 6)}`;
        for (const t of (listed?.tools || []) as any[]) {
          if (tools.length >= MAX_TOOLS) break;
          const toolSlug = sanitize(t.name, 30) || "tool";
          let ns = `mcp-${serverSlug}-${toolSlug}`.slice(0, 60);
          let i = 1;
          while (usedNames.has(ns)) ns = `${`mcp-${serverSlug}-${toolSlug}`.slice(0, 57)}-${i++}`;
          usedNames.add(ns);
          routing.set(ns, { client, originalName: t.name });
          tools.push({
            type: "function",
            function: {
              name: ns,
              description:
                `[MCP: ${row.name}] ${t.description || t.name}`.slice(0, 1024),
              parameters:
                t.inputSchema && typeof t.inputSchema === "object"
                  ? t.inputSchema
                  : { type: "object", properties: {}, additionalProperties: true },
            },
          });
        }
      } catch (err: any) {
        console.warn(`[mcp-client] server "${row.name}" skipped:`, err?.message);
        try {
          await client?.close();
        } catch { /* ignore */ }
      }
    })
  );

  if (tools.length === 0) {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    return EMPTY;
  }

  return {
    tools,
    hasTool: (name: string) => routing.has(name),
    async call(name: string, args: Record<string, unknown>): Promise<string> {
      const route = routing.get(name);
      if (!route) return JSON.stringify({ error: `Unknown MCP tool: ${name}` });
      try {
        const result: any = await withTimeout(
          route.client.callTool({ name: route.originalName, arguments: args || {} }),
          CALL_TIMEOUT_MS,
          `callTool ${name}`
        );
        // MCP returns content blocks; flatten text for the model.
        const text = ((result?.content || []) as any[])
          .map((c) => (c?.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");
        return JSON.stringify({
          tool: name,
          is_error: !!result?.isError,
          result: text || "(no content)",
        });
      } catch (err: any) {
        return JSON.stringify({ tool: name, error: err?.message || "MCP tool call failed" });
      }
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
