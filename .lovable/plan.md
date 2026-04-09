

## Smart Title Generation for Quick Capture

### Problem
Both the client-side QuickCapture component and the `quick-capture` edge function use `content.slice(0, 50)` as the title — cramming raw text into the title field.

### Solution
Add a `"title"` field to the AI metadata extraction prompt in the `quick-capture` edge function. The AI already processes the note content for metadata — we just need it to also generate a smart title. Then update the note title alongside the metadata.

The client-side QuickCapture component will continue using the truncated placeholder title for instant feedback, but the server will overwrite it with the AI-generated title once processing completes.

### Algorithm (encoded in the system prompt)
1. Look at the first line of the note
2. If it is 10 words or fewer, evaluate whether it works as a title — if yes, use it as-is
3. Otherwise, generate a concise title (max 8 words) that captures the essence of the note

### Changes

**1. `supabase/functions/quick-capture/index.ts`**
- Update `METADATA_SYSTEM_PROMPT` to include a `"title"` field with instructions: if the first line is 10 words or fewer and reads like a natural title, use it verbatim; otherwise generate a short title (max 8 words)
- After parsing the AI response, extract the `title` field from the result
- Include `title` in the update payload so the note title gets overwritten with the AI-generated one
- Return the final title in the response

**2. `src/components/notes/QuickCapture.tsx`**
- No changes needed — the placeholder title is fine for instant feedback; the server overwrites it

### Files Modified
- `supabase/functions/quick-capture/index.ts`

