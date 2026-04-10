

## Fix: Notes Under 50 Words Never Get AI-Processed

### Root Cause
The auto-processing in `NoteEditor.tsx` only triggers when a note has **50+ words** (`MIN_WORDS_FOR_PROCESSING = 50`). The Sebastian Logemann note has ~40 words, so `process-note` never ran — no metadata was extracted, no people were detected, and no review queue item was created.

### Solution
Lower the threshold and add a fallback so shorter notes still get processed.

### Changes

**File: `src/components/notes/NoteEditor.tsx`**
- Lower `MIN_WORDS_FOR_PROCESSING` from `50` to `15`. A 15-word note has enough content for meaningful metadata extraction (title, people, topics). This ensures short but substantive notes like the Sebastian one get processed.

### Why 15?
- Notes under ~15 words are typically titles-only or stubs with nothing meaningful to extract
- 15 words is enough to mention a person, a topic, and some context
- The AI cost per short note is minimal (small input → small token usage)

### Scope
One constant changed in one file. No backend changes needed — the edge function already handles short content fine.

### Immediate Fix for This Note
After deploying, the user can click the "Classify" button (sparkle icon) in the note toolbar to manually trigger processing for this existing note, or simply make a small edit to trigger the auto-process timer.

