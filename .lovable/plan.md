# Mistral Document AI für PDF- und Bildverständnis

Du hast recht – wir hatten Mistral OCR als Lösung festgelegt. Im aktuellen Code wird stattdessen `gpt-4o-mini` über OpenRouter mit `image_url` aufgerufen, und PDFs als `data:application/pdf;base64,...` durchgereicht. Genau daran scheitern die 11 PDFs ("Invalid MIME type. Only image types are supported."). Bilder funktionieren zwar, aber wir wechseln sie konsistent mit auf Mistral, damit ein einziger Ingestion-Pfad existiert.

## Ziel
PDFs und Bilder werden über **Mistral Document AI** (`mistral-ocr-latest`) verarbeitet:
- PDFs: vollständiger Text **pro Seite** + eingebettete Bilder werden separat beschrieben.
- Bilder: OCR-Text + Vision-Beschreibung.
- Ergebnis landet weiterhin in `media_analysis` (ein Record pro Seite/Bild), inkl. `extracted_text`, `description`, `topics`, `embedding`.

## Änderungen

### 1. Secret
- Neu: `MISTRAL_API_KEY` (per `add_secret` anfragen, nachdem du den Plan freigibst).

### 2. `supabase/functions/analyze-media/index.ts` umbauen
- **Bilder**: `POST https://api.mistral.ai/v1/ocr` mit `model: "mistral-ocr-latest"` und `document: { type: "image_url", image_url: "data:<mime>;base64,..." }`. Liefert `pages[0].markdown` (= OCR-Text). Für die `description` zusätzlich ein kurzer Call an `pixtral-12b` (Vision-Chat) mit demselben Bild → 2–3 Sätze + Topics + `content_type`. Beides zusammen in den Record.
- **PDFs**: 
  1. PDF aus Storage laden, als `data:application/pdf;base64,...` an `/v1/ocr` schicken mit `include_image_base64: true`.
  2. Antwort enthält `pages[]` mit `markdown` und ggf. `images[]` (eingebettete Grafiken).
  3. **Pro Seite** einen `media_analysis`-Record schreiben (`page_number = idx+1`), `extracted_text = page.markdown`.
  4. Für jedes eingebettete Bild auf der Seite zusätzlich ein Pixtral-Call für die Beschreibung, in `raw_analysis.images[]` ablegen; die kombinierten Bildbeschreibungen in `description` der Seite mergen.
  5. `topics` werden aus dem Gesamttext der Seite via Pixtral/Mistral-Chat extrahiert (ein Call pro Seite, oder ein Sammel-Call am Ende – ich mache es pro Seite für saubere Embeddings).
- Token-Accounting weiterhin über `deductTokens` (Mistral liefert `usage` mit; Fallback wie heute).
- Embeddings (`getEmbeddingWithCredits`) bleiben wie bisher pro Record.

### 3. `analyze-pdf` vereinfachen
- Bleibt als dünner Wrapper, ruft aber `analyze-media` mit `media_type: "pdf"`. Keine inhaltlichen Änderungen, nur Kommentar aktualisieren ("now uses Mistral OCR").

### 4. `backfill-media-analysis`
- Status-Filter `analysis_status = 'failed'` triggert Re-Analyse aller bestehenden kaputten PDFs über den neuen Pfad. Bereits vorhanden – nur dokumentieren, dass dies jetzt funktioniert.

### 5. UI / Retry
- `useReanalyzeMedia` existiert. In der Media Library bei `failed`-Status einen kleinen "Erneut analysieren"-Button anzeigen (falls noch nicht da – wird im Build-Schritt verifiziert).

## Out of Scope
- Multi-PDF-Parallelisierung, Caching, Page-Range-Selection. Erstmal alle Seiten.
- Wechsel der Bildanalyse von Mistral zurück zu OpenRouter falls Pixtral schlechter performt – können wir später A/B testen.

## Kosten/Limits
- Mistral OCR ist günstig (~$1/1000 Seiten), Pixtral pro Bild gering. Per `checkBalance` & `deductTokens` weiterhin in unser Credit-System integriert (Tokens grob via `usage` oder Fallback `1000`).

## Nach Freigabe brauche ich von dir
- Bestätigung, dass ich `MISTRAL_API_KEY` als Secret anfragen darf (du legst ihn dann in Lovable Cloud ab).
