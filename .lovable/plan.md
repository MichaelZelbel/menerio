## Was du beobachtest

Stimmt: jede Gruppe speichert ihre eigene Stage-Liste in `contact_groups.stages` (JSON-Array von `{id, label, color}`). Beim Anlegen werden sie aus einem Template übernommen (z. B. "Researching → Contacted → Following Up → Meeting → Decided") oder — bei manuellem Anlegen über `Groups.tsx` — aus einem generischen Default ("New / Active / Done"). Daher die unterschiedlichen Bezeichnungen zwischen alten und neuen Gruppen.

Aktuell gibt es **keine UI**, um die Stages einer bestehenden Gruppe zu ändern. Das `updateGroup`-Hook unterstützt das Feld bereits, es fehlt nur das Frontend.

## Plan: Stage-Editor im "About"-Tab

Ich baue einen kleinen, einfachen Editor in den **About-Tab** der Gruppe (`/dashboard/groups/:slug` → Tab "About"). Keine Migration nötig — alles existiert schon im Schema.

### Funktionen
- Liste aller Stages der Gruppe als editierbare Reihen
- Pro Stage: Label umbenennen, Farbe ändern, hoch/runter verschieben, löschen
- Button "Add stage" am Ende
- Speichern zusammen mit den anderen About-Feldern über den vorhandenen "Save changes" Button

### Sicherheit / Datenintegrität
- Stage-`id` bleibt stabil beim Umbenennen (nur `label` ändert sich) → bestehende Memberships behalten ihren Status, nur das angezeigte Label ändert sich
- Beim **Löschen** einer Stage: Memberships, die dort liegen, werden auf die erste verbleibende Stage verschoben (Warnung im UI: "X members will move to {firstStage}")
- Mindestens 1 Stage muss übrig bleiben
- Neue Stages bekommen automatisch eine generierte `id` (z. B. `slugify(label) + "-" + shortid`)

### UI-Skizze

```text
About-Tab
├─ Name / Type / Description / Purpose / ...   (wie heute)
└─ Pipeline Stages
   ┌─────────────────────────────────────────┐
   │ ⠿  [New          ] [#color] ▲ ▼  🗑    │
   │ ⠿  [Researching  ] [#color] ▲ ▼  🗑    │
   │ ⠿  [Contacted    ] [#color] ▲ ▼  🗑    │
   │ + Add stage                              │
   └─────────────────────────────────────────┘
   [Save changes]
```

### Dateien
- `src/pages/GroupDetail.tsx` — About-Tab erweitern, `stages` in `aboutForm` aufnehmen, im Save-Call mitsenden
- (optional) neue Komponente `src/components/groups/StagesEditor.tsx` für Übersichtlichkeit
- `src/hooks/useGroups.ts` — `updateGroup` akzeptiert `stages` bereits implizit (`Json`); ggf. Typ ergänzen

### Bonus (klein, separat)
Default-Stages beim manuellen Gruppen-Anlegen in `Groups.tsx` an die Template-Konvention angleichen — z. B. "New / Active / Done" → "New / Active / Done" beibehalten, **aber** im Anlege-Dialog optional eine "Use stages from template" Auswahl. (Sage Bescheid, wenn du das auch willst — sonst lasse ich's weg.)

### Nicht enthalten
- Drag-and-Drop Reordering (nur ▲▼ Buttons) — schneller zu liefern; DnD kann ich nachreichen, wenn gewünscht
- Globale Stage-Vorlagen / Bibliothek
