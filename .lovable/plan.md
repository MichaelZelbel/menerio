## Problem

When the user hides a note from AI, the **AI footprint dialog** auto-opens. If the note never contributed anything (e.g. it was rolled back from the Review Queue first), the dialog still shows:

> "…here is what AI already derived from it. Remove individual contributions or wipe everything at once."

…immediately followed by "Nothing to clean up". The header contradicts the body.

## Fix

Two small, presentation-only changes:

1. **`useToggleAiVisibility.onSuccess` in `src/components/common/AiVisibilityButton.tsx`** — before opening the footprint dialog after hiding a note, fetch the footprint first via the existing `useAiFootprint` query (or a one-shot fetch) and only open the dialog when `total > 0`. If empty, skip the dialog entirely — the success toast ("Hidden from AI…") is already shown.

2. **`AiFootprintDialog.tsx` description copy** — make the intro conditional so the wording matches the body:
   - When `total > 0`: keep current text.
   - When `total === 0` (defensive, in case the dialog is opened from elsewhere): show "This note is now hidden from AI. New pipelines will skip it." — drop the "here is what AI already derived / remove contributions" sentence.

No backend, schema, or business-logic changes. Pure UI / copy fix.

## Files to edit

- `src/components/common/AiVisibilityButton.tsx` — gate `setFootprintOpen(true)` on a non-empty footprint.
- `src/components/common/AiFootprintDialog.tsx` — split the `DialogDescription` based on `total`.
