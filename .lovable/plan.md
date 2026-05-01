## Ziel

Das via GitHub-Sync geschriebene Repo soll ein **vollwertiger Obsidian-Vault** werden — inklusive Bildern und anderen Anhängen. Du sollst das Repo lokal klonen, in Obsidian öffnen, Bilder sehen, neue Bilder einfügen und nach Push wieder in Menerio sehen können. Existierende Vaults (auch Evernote-importierte mit `_resources/<Note>.resources/`) müssen wir lesen können.

## Recherche-Ergebnis: Pfad-Konventionen

Obsidian rendert `![[file.png]]` **pfadunabhängig** (Default "Shortest path when possible") — die Datei kann irgendwo im Vault liegen. Es gibt keinen einzigen "richtigen" Pfad, sondern verschiedene Konventionen je Quelle:

| Quelle | Pfad-Schema |
|---|---|
| Manuelles Setup (häufigster Default) | `attachments/` |
| Evernote-Importer / Yarle | `_resources/<NoteName>.resources/` |
| Notion-Importer | `<NoteName>/` neben der Note |
| Apple Notes / Bear | `attachments/` oder `media/` |

**Entscheidung:**
- **Schreiben (Menerio → GitHub)**: Default `attachments/` im Vault-Root (Standard-Konvention der Obsidian-Community).
- **Lesen (GitHub → Menerio)**: Wir scannen den **gesamten Vault-Tree** nach Binaries und lösen Wikilinks pfadunabhängig per **Filename-Lookup** auf — damit sind wir mit allen oben genannten Layouts inkl. dem Evernote-Schema aus dem Screenshot kompatibel.

## Aktuelle Lücken (Ist-Zustand)

- Bilder leben in Supabase Bucket `note-attachments` als `{userId}/{uuid}.{ext}`.
- Im Markdown stehen **Signed URLs** (7 Tage gültig) → in Obsidian nach Ablauf tot.
- `github-sync-export` schreibt nur `*.md`, committet keine Binaries.
- `github-sync-pull` und `github-import-vault` lesen nur `*.md`, ignorieren Binaries und `![[…]]`-Embeds.

## Architektur

```
┌─────────────────┐       Export        ┌────────────────────────┐
│ Supabase Bucket │  ────────────────▶  │ GitHub Repo            │
│ note-attachments│   schreibt nach     │  attachments/*.png     │
│ {uid}/{uuid}.ext│                     │  notes/*.md            │
│                 │  ◀────────────────  │  (liest auch:          │
│                 │   Pull/Import       │   _resources/*/*,      │
│                 │   scannt ALLES      │   assets/*, images/*)  │
└─────────────────┘                     └────────────────────────┘
        ▲                                         ▲
        │                                         │
   Web-Anzeige                              Obsidian-Anzeige
   (Signed URL via                          (Wikilink-Resolver,
    Resolver)                                pfadunabhängig)
```

**DB-Format (Single Source of Truth):** Markdown enthält Obsidian-Wikilink-Embeds `![[filename.ext]]`. Beim Web-Render löst eine Resolver-Schicht den Filename gegen `note_attachments` auf und ersetzt zur Anzeige durch Signed URLs.

## Datenmodell

Neue Tabelle `note_attachments`:

```sql
create table public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  filename text not null,            -- "screenshot-2026-01.png"
  storage_path text not null,        -- "{uid}/{uuid}.png" im Bucket
  size_bytes integer,
  mime_type text,
  sha256 text,                       -- für Sync-Diffing
  github_path text,                  -- "attachments/screenshot-2026-01.png" oder importierter Pfad
  github_sha text,                   -- aktueller Blob-SHA im Repo
  github_synced_at timestamptz,
  source text default 'menerio',     -- 'menerio' | 'imported' | 'github'
  created_at timestamptz default now(),
  unique (user_id, filename)
);
```

RLS: nur Owner. Indexe auf `(user_id, filename)` und `(user_id, sha256)`.

## Upload-Flow (`src/lib/upload-attachment.ts`)

- Filename: `sanitize(file.name)` + Kollisionssuffix (`-2`, `-3`, …) bei Duplikaten pro User.
- Storage-Pfad bleibt intern `{userId}/{uuid}.{ext}` (stabil, unabhängig vom Anzeigenamen).
- Nach Upload: Eintrag in `note_attachments` (filename, storage_path, sha256, mime_type, size_bytes).
- Rückgabe um `filename` ergänzt.
- TipTap-Image-Insert schreibt im Markdown **nicht** mehr Signed URL, sondern `![[filename.ext]]`.

## Web-Render

`src/utils/markdown-converter.ts` erkennt bereits `![[...]]` als Bild. Ergänzung:
- Vor dem Render einmalig referenzierte Filenames in `note_attachments` nachschlagen.
- Signed URLs erzeugen (Cache pro Session, TTL 6 Tage).
- Im HTML als `<img src="signed-url" data-wikilink-filename="…">` einsetzen.

## Edge Function `github-sync-export`

1. Markdown der Note parsen, alle `![[filename.ext]]` und Legacy-`![](signed-url)` extrahieren.
2. Pro Attachment:
   - In `note_attachments` lookuppen (per filename).
   - Falls noch nicht im Repo **oder** lokaler `sha256` ≠ Repo-`github_sha`: Datei aus Bucket holen, base64 nach `<vault>/attachments/<filename>` committen (GitHub Contents API), `github_path`, `github_sha`, `github_synced_at` aktualisieren.
3. Markdown vor dem Schreiben normalisieren: Signed-URL-Bilder → `![[filename.ext]]`.
4. `<vault>/notes/...md` committen wie bisher.

## Edge Function `github-sync-pull`

1. Vollen Vault-Tree via `git/trees?recursive=1` ziehen.
2. Alle Binär-Pfade erkennen (Extension-Filter: png/jpg/jpeg/gif/webp/svg/pdf/mp3/mp4/m4a/wav/ogg/heic) — **egal in welchem Ordner** (`attachments/`, `_resources/Foo.resources/`, `assets/`, `images/`, `media/`, …).
3. Pro Binary:
   - Filename extrahieren = letzter Pfad-Bestandteil.
   - Falls in `note_attachments` (per filename) und `github_sha` aktuell: skip.
   - Sonst: Blob laden, in Bucket unter neuem `{uid}/{uuid}.{ext}` ablegen, Eintrag in `note_attachments` upserten (filename als key, `github_path` = Original-Pfad, `source = 'github'`).
4. Konflikt zweier Files mit gleichem Filename in unterschiedlichen Ordnern: zweiter bekommt Suffix `-2`, im DB-Record festhalten.
5. Markdown-Pull bleibt; `![[filename]]` wird übernommen, `![](relativer/pfad/file.png)` zu `![[file.png]]` normalisiert.

## Edge Function `github-import-vault`

- Vor dem Notes-Import den vollständigen Tree scannen und alle Binaries wie in `github-sync-pull` in Bucket + `note_attachments` synchronisieren — funktioniert damit out-of-the-box für Evernote-importierte Vaults (`_resources/<Note>.resources/*.jpg`).
- Beim Notes-Import: `![](irgendein/pfad/file.png)` → `![[file.png]]` rewriten.

## Settings (`GitHubSyncSettings.tsx`)

- Neues Feld **"Attachment folder"** mit Default `attachments` — speichert in `github_connections.attachment_folder`. Wird vom Export verwendet. Lesen/Pull ignoriert das Feld und scannt alles.
- Migrate-Card: "X bestehende Bilder können in Obsidian-Format überführt werden — jetzt migrieren" (triggert Backfill).

## Backfill (`backfill-attachment-filenames`)

Einmaliger Job:
1. Alle Notes durchscannen, Signed-URL-Referenzen auf `note-attachments`-Bucket erkennen.
2. Pro Storage-Path lesbaren Filename ableiten (`attachment-{shortid}.{ext}` falls UUID-basiert).
3. `note_attachments`-Eintrag erzeugen (`source = 'menerio'`).
4. Markdown der Note rewriten: Signed URL → `![[filename.ext]]`.
5. Beim nächsten GitHub-Sync werden die Files automatisch ins `attachments/` gepusht.

## Edge Cases & Entscheidungen

- **Filename-Kollisionen** (gleicher Name aus verschiedenen Quellen): zweiter bekommt Suffix `-2`. Wikilinks werden nicht umgeschrieben, falls Note bereits darauf zeigt — der "ältere" Filename gewinnt.
- **Nicht-Bild-Anhänge** (PDF, mp3, mp4): gleiches Schema, gleicher Ordner. Obsidian rendert nativ.
- **Dateigröße**: GitHub Contents API erlaubt 100 MB/File, harmonisiert mit unserem 20 MB Bucket-Limit.
- **Privates Repo empfohlen**: Da Bilder jetzt im Repo liegen. Hinweis in den Settings.
- **Web bleibt funktional ohne GitHub-Sync**: Wikilinks werden auch ohne Sync via Resolver/Signed URL aufgelöst — DB ist Single Source of Truth.
- **Evernote-Vault-Kompatibilität (Screenshot)**: Beim Import werden alle `_resources/*.resources/*.{jpg,png}` automatisch eingelesen. Wikilinks im Markdown finden sie über den Filename. Beim späteren Export legt Menerio neue Bilder zentral in `attachments/` ab — alte Bilder bleiben in ihren Original-Ordnern (nicht-destruktiv). Optional in Settings: "Re-organize all attachments into attachments/" Button.

## Geänderte / neue Dateien

**Neu:**
- `supabase/migrations/<ts>_note_attachments.sql` — Tabelle + RLS + Indexe.
- `supabase/migrations/<ts>_github_attachment_folder.sql` — Spalte `attachment_folder` in `github_connections`.
- `supabase/functions/backfill-attachment-filenames/index.ts` — One-shot Migration.

**Angepasst:**
- `src/lib/upload-attachment.ts` — Filename-Sanitize, Kollisions-Suffix, `note_attachments`-Insert, `filename`-Rückgabe.
- `src/components/notes/extensions/*` (Image-Insert) — `![[filename]]` schreiben statt URL.
- `src/utils/markdown-converter.ts` — Wikilink-Embed Resolver (filename-Lookup → Signed URL).
- `supabase/functions/github-sync-export/index.ts` — Attachment-Extraction, Binary-Commit nach `attachments/`, URL→Wikilink-Normalisierung.
- `supabase/functions/github-sync-pull/index.ts` — Vault-weiter Binary-Scan, Bucket-Upload, Pfad-Normalisierung.
- `supabase/functions/github-import-vault/index.ts` — Binary-Vorabsync (inkl. `_resources/`-Layout), Pfad→Wikilink-Rewrite.
- `src/components/settings/GitHubSyncSettings.tsx` — `attachment_folder`-Feld, Migrate-Card, optionaler "Re-organize"-Button.

## Out of Scope

- Auto-Reorganisation existierender Vaults in einen einheitlichen Ordner (außer per Opt-in-Button).
- Bild-Resizing/Optimierung für Web.
- Versionierung von Attachments (überschreibt by-filename).
