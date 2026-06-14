# People Detail: Profile als Default, Overview integrieren

## Ziel
Beim Öffnen einer Person landet man direkt auf dem **Profile**-Tab (ganz links). Der bisherige **Overview**-Tab wird entfernt, seine Inhalte (Private Notes + Related Notes) wandern in den Profile-Tab.

## Änderungen

### 1. Tab-Struktur in `src/pages/People.tsx`
- Entferne `TabsTrigger value="overview"` und den gesamten `TabsContent value="overview"`-Block.
- Verschiebe `TabsTrigger value="profile"` an die erste Position (links).
- Setze `activePersonTab` Default-State von `"overview"` auf `"profile"`.
- Aktualisiere den "Back to People"-Button: Reset auf `"profile"` statt `"overview"`.

### 2. Private Notes + Related Notes in `src/components/people/ContactProfileTab.tsx` integrieren
- Übernehme den **Notes**-Block (Edit-Mode vs. Read-Mode) aus dem alten Overview-Tab.
- Übernehme den **Related Notes**-Block (Liste verlinkter Notes) aus dem alten Overview-Tab.
- Platziere beide Sektionen **oben** im Profile-Tab, vor LifeEventsStrip und RelationshipsSection.
- Der Edit-Mode für Notes wird über den bestehenden `isEditing`-Zustand in `People.tsx` gesteuert; `ContactProfileTab` bekommt `notes`, `editingNotes`, `relatedNotes` und Callbacks (`onEditNotes`, `onSaveNotes`) als Props.

### 3. Prop-Schnittstelle erweitern
`ContactProfileTabProps` erhält:
```
notes: string | null
editingNotes: string | null
isEditing: boolean
relatedNotes: Note[]
onEditNotes: () => void
onSaveNotes: (notes: string) => void
```

## Was bleibt erhalten
- **Private Notes**: Freitext-Notizfeld bleibt vollständig editierbar.
- **Related Notes**: Automatisch verknüpfte Notes bleiben sichtbar und klickbar.
- Alle anderen Tabs (Groups, Conversation, Timeline, Documents) bleiben unverändert.

## Was verschwindet
- Nur der separate "Overview"-Tab als eigenständiger Reiter.
