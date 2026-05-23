## Korrekturen am MCP-Sichtbarkeits-Button

### 1. Beschriftung: „MyCö" → „MCP"

Diktierfehler überall im UI ersetzen. Backend-Code, DB-Spalten und Hook-Namen bleiben unverändert — nur sichtbare Strings.

Betroffen: `src/components/common/McpVisibilityButton.tsx`
- Label im sichtbaren Zustand: `"MCP"` statt `"MyCö"`.
- Tooltip-Texte:
  - sichtbar (item): „Visible to MCP clients (ChatGPT, Claude, …). Click to hide."
  - versteckt (item): „Hidden from MCP clients. Click to make visible."
  - sichtbar (person): „Visible to MCP clients. Click to hide this person and everything linked to them."
  - versteckt (person): „Hidden from MCP clients. Linked notes & moments are hidden too. Click to make visible."

Außerdem Toast-Texte in `src/hooks/useMcpVisibility.ts` bleiben bereits korrekt („MCP clients") — keine Änderung nötig.

Kurzer Sweep nach versehentlichen weiteren „MyCö"-Vorkommen via `rg -n "MyCö"` und ggf. ersetzen.

### 2. Bug: Button aktualisiert sich verzögert beim Zurücktoggeln auf „Visible"

**Diagnose.** `McpVisibilityButton` ist ein reiner Prop-Konsument (`hidden` kommt von oben). Nach dem Klick:
1. Mutation läuft → `pending=true` → Spinner.
2. Erfolg → `qc.invalidateQueries({ queryKey: ["notes"] })`.
3. `useNotes` refetched, `allNotes` aktualisiert sich, `selectedNote` (in `Notes.tsx`) wird über `useMemo` neu berechnet, `NoteEditor` re-rendered, neuer `hidden`-Wert kommt am Button an.

Die Verzögerung beim Zurückwechseln entsteht, weil zwischen Mutation-Ende und Refetch-Ergebnis ein sichtbares Frame-Fenster liegt — beim Hidden-Setzen merkt man es kaum (Spinner deckt Wechsel ab + Border-Dashed-Klasse ist sehr augenfällig), beim Zurücksetzen wirkt das identische Frame wie „nichts passiert", bis ein Hover-Event einen Re-Render erzwingt.

**Fix.** `McpVisibilityButton` führt einen lokalen optimistic-State:

```ts
const [optimistic, setOptimistic] = useState(hidden);
useEffect(() => setOptimistic(hidden), [hidden]);

const onClick = () => {
  const next = !optimistic;
  setOptimistic(next);          // sofortiges UI-Feedback in beide Richtungen
  if (kind === "person") togglePerson.mutate(
    { id, isSensitive: next },
    { onError: () => setOptimistic(hidden) }
  );
  else toggleItem.mutate(
    { id, visibility: next ? "hidden" : "visible" },
    { onError: () => setOptimistic(hidden) }
  );
};
```

Render verwendet `optimistic` statt `hidden` für Icon, Label, Tooltip und Border-Variante. Bei Fehler wird auf den Prop-Wert zurückgesetzt, bei Erfolg sorgt der `useEffect` für Sync mit der frisch gefetchten Wahrheit. Damit ist das Toggling in beide Richtungen sofort sichtbar — unabhängig vom Refetch-Timing.

Zusätzlich: `qc.invalidateQueries({ queryKey: ["notes"], refetchType: "active" })` im Hook lassen wie es ist (kein Fix nötig, der Re-Render hängt jetzt nicht mehr daran).

### Geänderte Dateien

- `src/components/common/McpVisibilityButton.tsx` — Label/Tooltips „MCP", lokaler Optimistic-State.

### Verifikation

- Alle Buttons zeigen „MCP" statt „MyCö"; keine „MyCö"-Treffer mehr in `src/`.
- Klick „MCP" → „Hidden" wechselt sofort, Mutation läuft im Hintergrund, Spinner kurz im Icon.
- Klick „Hidden" → „MCP" wechselt ebenfalls sofort — kein Hover mehr nötig.
- Bei simuliertem Mutation-Fehler springt der Button zurück in den vorherigen Zustand.
