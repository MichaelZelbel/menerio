## Was wirklich schiefläuft

In den Edge-Logs sieht man die Anfragen von ChatGPT:

```
POST /functions/v1/open-brain-mcp/?key=mnr_c43a5b43980ef2b40a25339e135fca0ad1d15b2d6c441f75
→ 401  (has_auth_header: false, auth_scheme: "none")
```

Zwei Probleme treffen gleichzeitig zu:

1. **ChatGPT schickt den Token als Query-Parameter `?key=...`**, nicht als `Authorization: Bearer ...` Header. Unser MCP-Server liest aktuell nur Header (`authorization`, `x-mcp-token`, `x-api-key`) und ignoriert Query-Parameter komplett → daher `has_auth_header: false`.

2. **Der verwendete Token hat das falsche Präfix.** Es ist `mnr_c43a...` (ein Hub-API-Key, 49 Zeichen). Der MCP-Server akzeptiert aber ausschließlich Personal-MCP-Tokens mit Präfix `mnr_mcp_` aus `Settings → MCP Server`. Selbst wenn der Header korrekt wäre, würde die Format-Validierung (`MCP_TOKEN_PATTERN`) den Token sofort ablehnen.

Das ist also kein instabiles System — es sind zwei spezifische, kombinierte Fehler. Aber die Fehlermeldung war so generisch ("Missing Authorization header"), dass das im ChatGPT-UI nicht erkennbar war.

## Fix

### 1. Query-Parameter als gültige Token-Quelle akzeptieren
In `supabase/functions/open-brain-mcp/index.ts` die `getAuthHeader`-Hilfsfunktion erweitern: zusätzlich `c.req.query("key")`, `c.req.query("token")` und `c.req.query("access_token")` lesen und als Bearer-Token behandeln. Damit funktionieren MCP-Clients, die Tokens nur via URL anhängen können (ChatGPT Custom Connectors, einige Browser-Tools).

### 2. Klarere Fehlermeldungen für die zwei häufigsten Fälle
Im Auth-Pfad:
- Wenn ein Token mit `mnr_` (aber **nicht** `mnr_mcp_`) ankommt → spezifische Meldung: *"Du hast einen Hub-API-Key verwendet. Der MCP-Server benötigt einen separaten Personal MCP Token. Erstelle ihn unter Settings → MCP Server."*
- Wenn das Token via Query-Parameter kam, dies im Server-Log vermerken (für Debugging künftiger Fälle).

### 3. UI-Hinweis in `src/components/settings/MCPConnectionManager.tsx`
Beim Anzeigen der Connection-URL einen kleinen Hinweis ergänzen:
> "ChatGPT Custom Connectors hängen den Token oft als `?key=...` an die URL an statt einen Header zu senden — beides wird unterstützt. Wichtig: nur Tokens mit Präfix `mnr_mcp_` funktionieren hier (nicht die Hub-API-Keys aus 'API Keys')."

Außerdem in den Copy-Button-Varianten eine Option **"URL mit Token"** anbieten (`https://.../open-brain-mcp/?key=<token>`), damit man sie direkt in ChatGPT einfügen kann.

### 4. Memory aktualisieren
`mem://integrations/mcp-and-slack-hub` ergänzen: MCP-Server akzeptiert Tokens jetzt sowohl via Header als auch Query-Parameter; nur `mnr_mcp_`-Präfix gültig.

## Geänderte Dateien
- `supabase/functions/open-brain-mcp/index.ts` (Query-Param-Auth + bessere Fehlermeldungen)
- `src/components/settings/MCPConnectionManager.tsx` (Hinweistext + URL-mit-Token-Copy)
- `mem://integrations/mcp-and-slack-hub` (Update)

Keine DB-Migration, keine neuen Secrets.
