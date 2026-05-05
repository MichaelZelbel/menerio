## Problem

Public share links (z. B. `/shared/177a1037b755`) zeigen immer „Note not found", obwohl die Edge Function `get-shared-note` den Inhalt korrekt liefert.

**Root cause:** `SharedNote.tsx` ruft die Edge Function via `fetch()` auf und liest `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` für den `apikey`-Header. Diese Env-Variable ist im Build aber nicht gesetzt (nur `VITE_SUPABASE_URL` und `VITE_SUPABASE_PROJECT_ID` existieren). Der Header ist `undefined` → Supabase-Gateway antwortet 401 → UI fällt auf den Fehlerpfad zurück.

## Fix

In `src/pages/SharedNote.tsx`:

1. Statt direkten `fetch()` mit Env-Variablen den projektweiten Supabase-Client nutzen, dessen Anon-Key bereits hartkodiert eingebettet ist:
   ```ts
   import { supabase } from "@/integrations/supabase/client";

   const { data, error } = await supabase.functions.invoke("get-shared-note", {
     method: "GET",
     headers: { /* apikey wird automatisch gesetzt */ },
     // token via query param – siehe unten
   });
   ```
   Da `functions.invoke` keine Query-Params bequem unterstützt, behalten wir `fetch()`, aber importieren URL+Key aus einer zentralen Stelle:
   ```ts
   const SUPABASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co";
   const SUPABASE_ANON_KEY = "<aus client.ts>";
   ```
   Sauberere Variante: beide Konstanten in `src/integrations/supabase/client.ts` zusätzlich exportieren (`export const SUPABASE_URL`, `export const SUPABASE_PUBLISHABLE_KEY`) und in `SharedNote.tsx` importieren.

2. Toten Vorab-Aufruf entfernen:
   ```ts
   supabase.functions.invoke("get-shared-note", { body: undefined, method: "GET" as any })…
   ```
   (verwirft sein Ergebnis und tut nichts Sinnvolles).

3. Auch den `Authorization`-Header weglassen — Function läuft mit `verify_jwt = false` und braucht nur `apikey`.

## Files

- `src/integrations/supabase/client.ts` — beide Konstanten zusätzlich `export`en.
- `src/pages/SharedNote.tsx` — Konstanten importieren, toten Invoke-Aufruf entfernen, `apikey`-Header zuverlässig setzen.

## Verification

Nach dem Fix sollte `https://menerio.com/shared/177a1037b755` die Notiz „Claude Code Skills" rendern. Edge Function selbst ist nachweislich gesund (Test mit Token liefert vollständigen JSON-Response).
