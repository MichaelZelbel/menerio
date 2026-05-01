## Ziel

Der Link "Test in chat" im Empty-State einer Kollektion (`/collections/:slug`) hat keinen Handler und tut nichts. Entfernen.

## Änderung

**Datei:** `src/pages/CollectionDetail.tsx` (Zeilen 1909–1914)

Das `<button>`-Element mit "Test in chat" wird ersatzlos gelöscht. Der umgebende Flex-Container behält den "New Item"-Button und zentriert ihn weiterhin korrekt.

Vorher:
```tsx
<div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
  <Button onClick={() => setSelectedItem({ id: "new" } as CollectionItem)}>
    <Plus className="mr-2 h-4 w-4" />
    New Item
  </Button>
  <button type="button" className="text-sm text-primary hover:underline">
    Test in chat
  </button>
</div>
```

Nachher: nur noch der `New Item`-Button im Container.

Keine weiteren Stellen betroffen (rg-Suche zeigt nur dieses eine Vorkommen).
