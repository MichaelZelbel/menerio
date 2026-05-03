## Diagnose

Der Token selbst funktioniert. Verifizierung:

- DB-Eintrag vorhanden: `mcp_api_tokens.id = 8dbe682b...`, Hash matcht, **nicht** revoked, kein `expires_at`.
- `last_used_at` wird bei jedem Lookup aktualisiert → Server hat den Token **mehrfach erfolgreich** angenommen (zuletzt 20:48:51, dann erneut beim Test).
- Direkter Test mit Bearer-Token gegen `https://mcp.menerio.com/` → **HTTP 200** mit gültiger MCP `initialize`-Antwort.

In den Edge-Function-Logs taucht ein `HEAD /open-brain-mcp/ → 401` auf. Reproduktion:

| Methode | Auth-Header | Resultat |
|---|---|---|
| `POST` | Bearer mnr_mcp_… | **200** ✅ |
| `HEAD` | _kein_ | **401** ❌ |
| `GET` | _kein_ | **401** ❌ |
| `HEAD` | Bearer mnr_mcp_… | 405 (Allow: GET, POST, DELETE) — vom MCP-Transport |

**Ursache:** Der MCP-Client von Craig (OpenCLAW) macht vor der eigentlichen JSON-RPC-Verbindung einen Discovery-Request (`HEAD /` oder `GET /`) **ohne** Authorization-Header, um zu prüfen ob der Endpoint existiert. Unsere `app.all("*")` lehnt diesen sofort mit 401 ab. Craig zeigt das als „401 Unauthorized" an, obwohl die spätere POST-Verbindung mit Bearer-Token gar nicht mehr versucht wird (oder wird, aber nach dem ersten Fehlschlag abgebrochen).

Ein zweiter, untergeordneter Faktor: Manche MCP-Clients senden den Token in einem Custom-Header (z.B. `X-API-Key`). Das ist hier aktuell unterstützt (`x-mcp-token`, `x-api-key`), aber möglicherweise nicht dokumentiert.

## Plan

### 1. Edge Function `open-brain-mcp`: Discovery-Probes ohne Auth zulassen

In `supabase/functions/open-brain-mcp/index.ts` direkt vor dem `app.all("*")`-Handler eine kleine Whitelist einbauen:

- `HEAD /` und `HEAD /*` → `200 OK` mit `WWW-Authenticate: Bearer realm="MCP"` Header (kein Body).
- `GET /` (ohne Auth) → `200` mit minimalem JSON `{ "name": "open-brain", "version": "1.0.0", "auth": "Bearer mnr_mcp_…" }`. Das ist für reine Discovery harmlos und enthält keinerlei Userdaten.
- Alle anderen Methoden / `GET` mit Body laufen weiter durch `authenticateMcpRequest`.

So bekommen Discovery-Tools, Health-Checks und Browser-Probes ein 200 / 405 statt 401, und der eigentliche `POST` mit Bearer-Token funktioniert weiterhin.

### 2. Logging verbessern (5 Zeilen)

Beim 401 zusätzlich loggen: `request.method`, `has_auth_header`, `auth_scheme` (z.B. `bearer` / `none` / `other`). Erleichtert das nächste Debugging deutlich.

### 3. UI-Hinweis in `MCPConnectionManager.tsx`

Im Connection-Snippet-Bereich ergänzen:
- expliziter Hinweis dass der Token **als `Authorization: Bearer mnr_mcp_…`** zu senden ist (nicht als URL-Parameter, nicht als `X-API-Key` — auch wenn letzteres als Fallback akzeptiert wird).
- Alternative Header-Namen (`X-API-Key`, `X-MCP-Token`) als „Falls dein Client kein Bearer kann"-Block in einem Accordion.

### 4. Verifikation nach Deploy

- `curl -I https://mcp.menerio.com/` → erwartet **200** (vorher 401).
- `curl -X POST https://mcp.menerio.com/ -H "Authorization: Bearer mnr_mcp_YM5Q…" -d '{"jsonrpc":"2.0",…initialize…}'` → erwartet weiterhin **200**.
- Craig (OpenCLAW) erneut verbinden lassen.

## Technische Details

**Datei:** `supabase/functions/open-brain-mcp/index.ts` (Zeilen ~2229–2245)

```ts
// Discovery / health probes — no auth required
app.options("*", (c) => new Response(null, { status: 204, headers: c.res.headers }));

app.on(["HEAD"], "*", (c) =>
  new Response(null, { status: 200, headers: { "WWW-Authenticate": 'Bearer realm="MCP"' } })
);

app.get("/", (c) => c.json({
  name: "open-brain",
  version: "1.0.0",
  transport: "streamable-http",
  auth: "Authorization: Bearer mnr_mcp_<token>"
}));

app.all("*", async (c) => { /* unverändert: authenticateMcpRequest + transport.handleRequest */ });
```

**Warum keine Code-Änderung an Token-Validation?** Der bestehende Hash-/Pattern-Check funktioniert. `last_used_at = 20:48:51` und der Live-Curl-Test (200 OK + `initialize` Response) sind der direkte Beweis.

## Was nicht geändert wird

- Token-Format, Pattern, Hash-Funktion, `lookup_mcp_token` RPC, RLS-Policies — alles korrekt.
- `verify_jwt = false` in `supabase/config.toml` — bereits gesetzt.
- Cloudflare-Worker auf `mcp.menerio.com` — leitet sauber durch.
