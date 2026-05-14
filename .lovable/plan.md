## Ziel

Notizen, die von Querino (oder anderen verbundenen Apps) via `receive-note` angelegt werden, sollen automatisch in einem nach der App benannten Ordner landen — z. B. `Querino/` — statt im Root des Notizbuchs.

## Vorgehen

**1. `supabase/functions/receive-note/index.ts` anpassen**

- Beim INSERT einer neuen externen Notiz: `folder_path` automatisch auf den App-Namen mit Großbuchstaben setzen (z. B. `Querino`), falls die Push-Payload keinen `folder_path` mitgeschickt hat.
- Hilfsfunktion: `app_name` → Title Case (`querino` → `Querino`).
- Wenn die externe App in der Payload explizit ein `folder_path` mitschickt, dieses respektieren (Override-Möglichkeit).
- Beim UPDATE bestehender Notizen: `folder_path` **nicht** überschreiben — der User kann die Notiz manuell verschoben haben und das soll erhalten bleiben.

**2. Bestehende Querino-Notizen (optional, separat)**

- Diese Migration betrifft nur **neue** Notizen. Falls gewünscht, könnten wir in einem zweiten Schritt ein einmaliges Backfill-Script anbieten, das alle existierenden Notizen mit `source_app = 'querino'` und `folder_path = ''` (oder `/`) in den `Querino`-Ordner verschiebt. Das mache ich nur, wenn du es ausdrücklich willst.

**3. GitHub-Sync-Auswirkung**

- Da `folder_path` von der GitHub-Sync-Logik genutzt wird, landen Querino-Notizen im Vault dann ebenfalls in einem `Querino/`-Unterordner. Das passt zur Obsidian-Konvention und ist konsistent.

## Was nicht geändert wird

- Keine DB-Migration nötig (`folder_path` existiert bereits).
- Keine Änderung an `link-note` (legt keine Notizen an).
- Keine Änderung am Frontend.
