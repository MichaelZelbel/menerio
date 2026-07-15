/**
 * On-demand web search tool for the chat agents.
 *
 * Implemented via OpenRouter's built-in `web` plugin so it reuses the existing
 * OPENROUTER_API_KEY and the credit system — no new vendor, no new secret. The
 * model only calls this when it decides it needs live/world information, so
 * there's no per-message search cost.
 *
 * To swap to a dedicated search API (Tavily/Serper/Brave) later, replace the
 * body of `runWebSearch` — the tool schema and call site stay the same.
 */
import { openRouterWithCredits } from "./llm-credits.ts";

// Cheap model to synthesize the web results. The `web` plugin does the actual
// searching; the model just summarizes + cites.
const WEB_SEARCH_MODEL = "deepseek/deepseek-v4-flash";
const MAX_RESULTS = 5;

/** OpenAI-style tool schema to advertise to the agent. */
export const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current information the user's notes cannot contain: news, current events, recent facts, prices, people's public info, product details, anything time-sensitive or outside Menerio. Returns a short synthesis with source URLs. Use this whenever the answer depends on up-to-date world knowledge.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A focused web search query (what to look up).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

/**
 * Run a web search and return a JSON string (fed back to the agent as a tool
 * result). Never throws for search failures — returns an error object so the
 * agent can recover — but re-throws INSUFFICIENT_CREDITS so the caller can map
 * it to the standard credits response.
 */
export async function runWebSearch(
  db: any,
  apiKey: string,
  userId: string,
  query: string
): Promise<string> {
  const q = String(query || "").trim();
  if (!q) return JSON.stringify({ error: "query required" });

  try {
    const res = await openRouterWithCredits(
      db,
      apiKey,
      userId,
      "web-search",
      "chat/completions",
      {
        model: WEB_SEARCH_MODEL,
        plugins: [{ id: "web", max_results: MAX_RESULTS }],
        messages: [
          {
            role: "system",
            content:
              "You are a web research assistant. Search the web and report the key facts that answer the query. Be concise and factual. Always include the source URLs you relied on.",
          },
          { role: "user", content: q },
        ],
      }
    );

    const msg = res.result?.choices?.[0]?.message ?? {};
    const answer: string = msg.content || "";

    // OpenRouter attaches url citations as message.annotations[].url_citation.
    const sources: { title?: string; url: string }[] = [];
    for (const a of (msg.annotations || []) as any[]) {
      const c = a?.url_citation;
      if (c?.url) sources.push({ title: c.title, url: c.url });
    }

    return JSON.stringify({
      query: q,
      answer: answer || "(no result)",
      sources,
    });
  } catch (err: any) {
    if (err?.message === "INSUFFICIENT_CREDITS") throw err;
    return JSON.stringify({
      query: q,
      error: err?.message || "web search failed",
    });
  }
}
