# Fix Internal Wikilink Clicks (Stuck Render Loop)

## Symptom
Clicking `[[Wikilinks]]` inside the note body does nothing. The same links in the "Outgoing links" / Backlinks panels below the note work fine.

## Root cause
`src/components/notes/MediaAnalysisOverlay.tsx` is in a "Maximum update depth exceeded" loop (visible in console). React is stuck re-rendering thousands of times per second, which delays/drops pointer events in the editor — so the WikilinkExtension's `handleClick` never gets a chance to run. The Outgoing-links panel lives outside this overlay, which is why those links still navigate.

The loop comes from a feedback cycle:

1. `scanMedia` (line 52) runs and calls `setMediaElements(elements)` with a freshly-built array every time, so React re-renders even when nothing changed.
2. `MediaBadge` (line 184) mutates `element.parentElement.style.position = "relative"` during render on every render.
3. The `MutationObserver` in `MediaAnalysisOverlay` (line 92, with `attributes: true`) observes that style mutation.
4. Observer fires → `setTimeout(scanMedia, 200)` → step 1 again.

The wikilink click path itself (`WikilinkExtension.addProseMirrorPlugins → handleClick`, `handleNavigateToNote → navigate(/dashboard/notes/:id)`) is correct; it just never runs because the main thread is saturated.

## Fix
Break the feedback loop in `src/components/notes/MediaAnalysisOverlay.tsx`:

1. **Stable state updates** — in `scanMedia`, only call `setMediaElements` when the set of media elements actually changed. Compare by a stable signature (sorted list of `src`s plus count) against the previous state via the functional setter form.
2. **Don't mutate DOM during render** — move the `element.parentElement.style.position = "relative"` write in `MediaBadge` into a `useEffect` keyed on `[element]`, so it runs once per element instead of on every render.
3. **Ignore style mutations from our own overlay work** — narrow the `MutationObserver` config: drop `attributes: true` (or restrict `attributeFilter` to `["src"]` only, which is what we actually care about for new media). Style writes will then no longer retrigger a scan.
4. **Throttle, don't pile up timers** — replace the unguarded `setTimeout(scanMedia, 200)` with a single tracked timer ref so rapid mutations coalesce into one rescan.

## Verification
- Open a note containing `[[Some Title]]` wikilinks (e.g. the currently-open note `58bcc21e-…`).
- Confirm the "Maximum update depth exceeded" warning is gone from the console.
- Click an in-body wikilink → URL changes to `/dashboard/notes/<id>` and that note loads.
- Click a wikilink in the Outgoing-links panel below → still works (regression check).
- Add/remove an image inside a note and confirm AI media badges still appear and re-scan correctly.

## Files touched
- `src/components/notes/MediaAnalysisOverlay.tsx`

No changes to WikilinkExtension, NoteEditor, or routing — those are working correctly; only the overlay's render storm needs to stop.
