# Note Graph: vom „Blobs-Brei" zu einer semantisch zoombaren Karte

## Problem

Aktuell skalieren die Knoten **mit der Welt** mit (Radius in Graph-Koordinaten), die Labels aber **mit dem Bildschirm** (`fontSize = 11 / globalScale`). Folge:

- Reinzoomen → Bubbles werden riesig, Labels bleiben gleich groß → Text wird im Verhältnis winzig und Knoten verdecken Nachbarn.
- Rauszoomen → Bubbles werden zu klein, alle Labels überlagern sich, man liest nichts.
- Es gibt keine „Level-of-Detail" — egal wie weit man rein- oder rauszoomt, der Informationswert pro Bildschirmfläche bleibt gleich.

Ziel: Zoom wird zu einer echten Navigationsachse. Weit raus = wenige, große, beschriftete Anker + Cluster-Hüllen. Nah ran = saubere, lesbare Detailansicht mit allen Titeln.

## Lösung im Überblick

```text
Zoomstufe        Was man sieht
────────────     ──────────────────────────────────────────────
weit raus (≤0.4) Cluster-Hüllen mit Topic-/Person-Label + Top-Anker
mittel (0.4-1.2) Knoten konstanter Bildschirmgröße,
                 nur „wichtige" Labels (Centrality top 25–40 %)
nah (1.2-2.5)    Alle Labels, leichter Mehrzeilen-Umbruch,
                 Kanten je nach Typ deutlich
sehr nah (>2.5)  Volltitel + Topic-Chips inline am Knoten
```

## Konkrete Änderungen in `src/pages/KnowledgeGraph.tsx`

### 1. Knoten in **Screen-Pixeln** zeichnen, nicht in Graph-Einheiten

Heute: `radius = 4–18` (Graph-Einheiten) → wächst mit Zoom.
Neu: `radius_world = (basePx + importance) / globalScale` → konstante Größe auf dem Bildschirm (~6–14 px), unabhängig vom Zoom. Beim Zoomen wird also der **Abstand zwischen Knoten** sichtbar, nicht die Knoten selbst.

Importance-Score: `log(1 + connectionCount)`, optional + Centrality aus `GraphAnalytics`.

### 2. Level-of-Detail (LOD) für Labels

Neuer Helper `computeLabelTier(node, zoom)`:

- **Tier 0** (immer sichtbar, ab Zoom ≥ 0.2): Person-Nodes, Top 10 % nach Connectivity, gepinnte/gemerkte Anker.
- **Tier 1** (ab Zoom ≥ 0.8): Top 40 %.
- **Tier 2** (ab Zoom ≥ 1.4): Alle übrigen.

Der bestehende „Labels: hover / always / never"-Switch bleibt, bekommt aber einen vierten Modus **Auto (LOD)** als Default — `always` wird zum Power-User-Override.

### 3. Label-Typografie reagiert auf Zoom

- Font-Size in **Screen-Pixeln**: 11 px bei Zoom ≤ 1, linear auf 14 px bei Zoom ≥ 2, gecapped.
- Bei Zoom > 1.6: kein `…`-Truncate mehr — stattdessen **Wortumbruch auf max. 2 Zeilen** (à 24 Zeichen).
- Bei Zoom ≤ 1: Truncate auf 18–24 Zeichen (heutige Logik, etwas straffer).
- Halo (Hintergrund-Rect) bleibt für Lesbarkeit, wird bei dichteren Labels semitransparenter.

### 4. Greedy Label-Collision-Avoidance

Vor dem Render-Loop: Labels nach Priorität sortieren (Tier 0 > Tier 1 > Tier 2, Tiebreaker = Connectivity). Pro Frame in einem `placedRects: DOMRect[]` Buffer prüfen, ob das geplante Label-Rect ein bereits platziertes schneidet. Bei Kollision: Label dieser Frame **nicht** zeichnen (Knoten bleibt sichtbar, Hover zeigt den Titel weiterhin).

Aufwand O(n²) bei < 500 Knoten unkritisch; sortierte Tier-0-Liste limitiert das Gros der Vergleiche.

### 5. Cluster-Hüllen bei weitem Zoom

Bei `globalScale < 0.45`:

- Aus `metadata.topics` der sichtbaren Knoten + aus `mentions_person`-Edges Cluster bilden (Knoten mit gemeinsamem Top-Topic oder gleicher Person).
- Pro Cluster ≥ 4 Knoten: konvexe Hülle (oder weicher Circle-Fit über Bounding-Box) zeichnen, sehr dezent (8 % Alpha der Cluster-Farbe), darüber **ein** großes Label „Topic · N notes" oder „People around X · N notes".
- Einzelne Knoten innerhalb des Clusters werden bei diesem Zoom unbeschriftet / als kleine Punkte gerendert.
- Doppelklick auf eine Hülle → `graphRef.zoomToFit` auf die Cluster-Bounds.

Cluster-Berechnung wird memoized und nur bei Daten-/Filter-Änderung neu gemacht.

### 6. Kanten je nach Zoom anpassen

- Sehr weit raus: nur `manual_link` + `mentions_person` + Top-Strength `semantic` (z. B. > 0.7) zeichnen, andere komplett ausblenden.
- Mittel: heutige Logik.
- Nah: alles inkl. dünner schwacher Semantik-Kanten; Strichstärke leicht erhöhen damit Linien nicht „verschwinden".

### 7. Mini-Map unten rechts

Kleines 160×120-Canvas absolut positioniert im Graph-Container:

- Zeigt **alle** Knoten als 1-px-Punkte in Type-Farben.
- Aktueller Viewport als gestrichelter Rahmen.
- Klick auf Mini-Map → `graphRef.centerAt()` auf die geklickte Stelle.

Macht „Wo bin ich gerade?" beim Reinzoomen trivial.

### 8. Bestehender „Size by connections"-Switch

Bleibt, schaltet jetzt zwischen **Importance** (Default, Bildschirmgröße variiert mit Centrality) und **Uniform** (alle Knoten 8 px). Tooltip wird angepasst.

## Was sich für den Nutzer ändert

- Beim Rauszoomen bekommt man eine echte **Übersichtskarte**: thematische Cluster, ein paar große Anker, lesbare Beschriftung — kein Bubble-Brei mehr.
- Beim Reinzoomen werden progressiv **mehr Titel sichtbar**, vorhandene Titel werden größer und vollständig lesbar; die Knoten bleiben handhabbar groß statt den Screen zu füllen.
- Mini-Map gibt jederzeit räumliche Orientierung.
- Hover und Selektion verhalten sich wie bisher.

## Out of Scope (Phase 2 falls gewünscht)

- WebGL-Render-Switch (aktuell react-force-graph-2d Canvas reicht für ≤ 2k Knoten).
- Persistente Cluster-Definitionen in der DB (Cluster bleiben ein reines Rendering-Konstrukt).
- Auto-Layout-Wechsel (z. B. radial um eine Person) — könnte später ein eigener „View"-Modus werden.
- Touch-Gestures-Optimierung.

## Risiken

- Cluster-Detection auf dem Render-Pfad muss memoized sein, sonst flackert es beim Pan.
- Greedy Collision kann bei sehr dichten Graphen „wichtige" Labels schlucken — Tier-0-Set sollte konservativ sein.
- Screen-konstante Knoten plus Force-Simulation: die Force-Repulsion arbeitet weiter in Graph-Koordinaten — beim sehr starken Reinzoomen sehen Abstände dann u. U. „leer" aus. Mit `cooldownTicks` + bestehendem Layout sollte das aber okay aussehen; ggf. d3-Force-Charge leicht anpassen.

## Reihenfolge der Umsetzung

1. Screen-konstante Knoten + LOD-Tier-Berechnung (Tier 0/1/2).
2. Label-Typografie inkl. Mehrzeilen-Umbruch bei hohem Zoom.
3. Greedy Collision-Avoidance.
4. Kanten-LOD.
5. Mini-Map.
6. Cluster-Hüllen bei weitem Zoom.
7. Tooltips und „Labels: Auto"-Default in der Sidebar.
