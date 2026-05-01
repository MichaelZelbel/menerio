## Problem

Schema- und Kollektions-Bearbeitung sind heute hinter einem ⋯-Icon ohne Label versteckt. Nutzer finden sie nicht und denken, Felder/Kategorien seien nicht editierbar. Die Funktion existiert vollständig in `/collections/:slug/schema` und im "Edit Collection"-Dialog.

## Änderungen

### 1. Sichtbaren "Customize"-Button auf der Kollektions-Detailseite

Datei: `src/pages/CollectionDetail.tsx` (Header-Toolbar, ca. Zeile 1860–1888)

- Neben "New Item" einen sekundären Button **"Customize"** mit `Settings2`-Icon hinzufügen, der direkt zu `/collections/${slug}/schema` navigiert.
- Das ⋯-Menü bleibt für "Edit Collection" (Name/Icon/Beschreibung/Agent Instructions) und "Delete Collection".
- Auf Mobile: nur Icon, Tooltip "Customize fields".

### 2. Empty-State um Hinweis ergänzen

Im Empty-State (bisher nur "New Item"-Button) zusätzlich einen unauffälligen Textlink **"Customize fields"** → führt zum Schema-Editor. Hilft beim ersten Aufruf einer frisch erstellten Kollektion (genau dein Fall).

### 3. Schema-Editor: bessere Beschriftung für Optionen

Datei: `src/pages/CollectionSchema.tsx`

- Bei `select`/`multiselect`-Feldern den Bereich für die Optionen klar mit "Categories / Options" labeln und einen kleinen Helper-Text ergänzen ("These are the choices users can pick from for this field"). Aktuell heißt das nur "Options" und ist für Nicht-Techniker nicht sofort als "Kategorien" erkennbar.

### 4. Memory-Update

Notieren, dass Schema/Collection-Bearbeitung über sichtbaren "Customize"-Button + ⋯-Menü zugänglich ist, damit ich es künftig konsistent halte.

## Out of scope

- Inline-Editing von Feldern direkt aus der Tabellenansicht (größerer Umbau)
- Migration bestehender Items bei Feld-Umbenennungen (passiert bereits automatisch über `key`-Mapping; UI-Hinweis wäre separates Thema)
