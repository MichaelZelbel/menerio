

## Guided Profile Entry UX

### Problem
Currently, all category sections are collapsed by default. Users must click to expand, then click "+ Add entry", then figure out what label to type. There's no guidance on what to fill in next.

### Design

**1. Auto-expand the neediest section**
- On page load, compute which category has the fewest entries (prioritizing "Identity & Basics" as tiebreaker via sort_order)
- Pass a `defaultExpanded` prop to `CategorySection` for that category
- That section renders open with the entry form already visible

**2. Replace free-text label input with a guided dropdown**
- Each default category gets a curated list of ~10 suggested labels (e.g., Identity: "Full name", "Pronouns", "Date of birth", "Nationality", "Languages spoken", "Nickname", "Time zone", "Preferred name", "Phone number", "Email")
- The `EntryForm` receives these suggestions and filters out labels already used
- Render a `Select` dropdown with the next unused suggestions + a "Custom entry" option at the bottom
- The first unused suggestion is pre-selected, so the user only needs to type their value and hit Save

**3. Always-visible entry form in expanded sections**
- Instead of requiring a "+ Add entry" click, the entry form is always shown at the bottom of an expanded section (as long as there are unused suggestions or the user picks "Custom entry")

### Files to change

**New file: `src/lib/profile-suggestions.ts`**
- Export a `CATEGORY_SUGGESTED_LABELS` map: `Record<string, string[]>` keyed by category slug
- Contains 10 suggested labels per default category

**`src/components/profile/EntryForm.tsx`**
- Add optional `suggestedLabels?: string[]` and `existingLabels?: string[]` props
- Replace the free-text label `Input` with a `Select` dropdown when suggestions are available
- Pre-select the first available (unused) suggestion
- Include a "Custom entry" option that switches to free-text input
- Keep the value `Textarea` and note-link as-is

**`src/components/profile/CategorySection.tsx`**
- Accept `defaultExpanded?: boolean` prop, use it as initial state for `expanded`
- Always show the `EntryForm` at the bottom when expanded (remove the `addingEntry` toggle)
- Pass `suggestedLabels` and `existingLabels` (derived from current entries) to `EntryForm`
- After saving, the form resets with the next suggestion pre-selected

**`src/pages/Profile.tsx`**
- Compute the "neediest" category: category with fewest entries, using sort_order as tiebreaker
- Pass `defaultExpanded={cat.id === neediestCategoryId}` to each `CategorySection`

### UX flow after implementation
1. User navigates to Profile
2. "Identity & Basics" (or whichever section needs most attention) is already open
3. The entry form is visible with "Full name" pre-selected in the label dropdown
4. User types their name, hits Save
5. Form resets, now showing "Pronouns" pre-selected
6. User can switch the dropdown to any other suggestion or pick "Custom entry" for free-text
7. Once all suggestions for a category are filled, the dropdown shows only "Custom entry"

