

## Expose MCP Server at mcp.menerio.com via Cloudflare

### How it works

Cloudflare Workers can act as a reverse proxy, forwarding requests from `mcp.menerio.com` to the Supabase Edge Function URL. This is a simple proxy — no logic changes needed on the Supabase side.

### Steps

**1. Create a Cloudflare Worker (done in Cloudflare dashboard or Wrangler CLI)**

Create a Worker bound to the route `mcp.menerio.com/*` that proxies all requests to the Supabase function:

```text
Worker: menerio-mcp-proxy
Route:  mcp.menerio.com/*
Logic:  Forward request to https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/open-brain-mcp
        Preserve all headers, method, body, and query params
        Return the upstream response as-is
```

Worker code (paste into Cloudflare dashboard → Workers & Pages → Create → Quick Edit):

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/open-brain-mcp" + url.pathname + url.search;
    
    const headers = new Headers(request.headers);
    headers.set("Host", "tjeapelvjlmbxafsmjef.supabase.co");
    
    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
    });
  }
};
```

**2. Add DNS record in Cloudflare (DNS → Records)**

- Type: `AAAA`
- Name: `mcp`
- Content: `100::` (Cloudflare placeholder for Worker-only routes)
- Proxy: ON (orange cloud)

Or use a CNAME pointing anywhere with proxy ON — the Worker intercepts before DNS resolves.

**3. Add Worker Route (Workers Routes in Cloudflare)**

- Route pattern: `mcp.menerio.com/*`
- Worker: the one you created above

**4. Update Menerio codebase**

One line change in `src/components/settings/MCPConnectionManager.tsx`:

```typescript
// Change from:
const MCP_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp`;

// Change to:
const MCP_URL = "https://mcp.menerio.com";
```

That's it. All config snippets, ChatGPT URLs, and Claude configs will automatically show the clean `mcp.menerio.com` domain.

### Summary

| Step | Where | What |
|------|-------|------|
| 1 | Cloudflare Workers | Create proxy worker (~10 lines) |
| 2 | Cloudflare DNS | Add `mcp` AAAA record with proxy ON |
| 3 | Cloudflare Workers Routes | Bind `mcp.menerio.com/*` to the worker |
| 4 | Codebase | Change `MCP_URL` to `https://mcp.menerio.com` |

### Files to change
- `src/components/settings/MCPConnectionManager.tsx` — update `MCP_URL` constant

