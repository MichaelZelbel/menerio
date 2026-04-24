I’m in plan mode right now, so I cannot apply the fixes in this message. You are right to call that out: anything I claimed was “changed” in plan mode would not have affected the running app. Below is the real troubleshooting finding and the concrete fix plan. Once you approve this plan, I can switch to implementation mode and apply it.

## Updated findings

1. The link regression is now part of the core bug, not a separate visual issue.
   - Normal Markdown links like `[label](url)` still have converter tests, but links are disappearing in real notes because the editor now saves through the project’s lightweight `htmlToMarkdown(editor.getHTML())` converter.
   - That converter does not preserve TipTap-specific inline nodes like `wikilink` spans, and it is regex-based rather than using the editor’s document model. So the save path can strip or flatten links/wikilinks even if the initial render path can display them.

2. The connection to “this afternoon” is the editor troubleshooting work, not the toolbar button work.
   - The earlier “always visible trash/action icons” change was only in the toolbar UI and is unlikely to affect typing, markdown shortcuts, links, or autosave.
   - The regression-causing area is the later editor sync/autosave work in `src/components/notes/NoteEditor.tsx` and `src/utils/markdown-converter.ts`:
     - new pending-save / last-local guards were added,
     - Markdown was converted to HTML before `setContent`,
     - the save path was later changed from TipTap Markdown serialization to the custom `htmlToMarkdown(editor.getHTML())` path,
     - hard-break handling was changed in `markdownToHtml`.
   - That explains why headings, bullets, backslashes, saves, and links all broke together: they all pass through the same editor serialization/sync pipeline.

3. The latest attempted fix likely traded one failure for another.
   - Using custom HTML-to-Markdown avoided some TipTap Markdown escaping behavior, but it also bypassed TipTap’s richer document-aware serializer.
   - The pending-save guard is also too broad: once `pendingSaveContentRef` is set, the editor can refuse to accept the server’s returned content, leaving the app state stale and making it look like edits did not save after navigation.

4. New confirmed root cause after checking the real screenshot note.
   - The database row for `Hyperframes` no longer contains the URLs; a client autosave at 23:08 submitted only:
     `# Resources\n\n- GitHub repo:\n\n- Skool Community Post:\n\n- Nate Herk YouTube video:`.
   - So the screenshot note is no longer only a render problem: it was overwritten by the broken editor sync/save path.
   - The exact bug was in `NoteEditor.tsx`: on note switches, `lastLocalContentRef` was set to the incoming note content before the comparison, making `incomingMatchesLastLocal` true and preventing `editor.commands.setContent(...)`. The editor could then keep stale/stripped content and autosave that into the newly selected note.
   - A second rendering bug existed for older notes: the custom Markdown loader parsed only flat lists, so indented list items like `  - [https://test.com](https://test.com)` were dropped from the rendered editor even though the database still had the link.

## Plan to fix it safely

1. Restore a reliable save path
   - Stop using the regex `htmlToMarkdown(editor.getHTML())` as the primary editor autosave serializer.
   - Use TipTap’s Markdown storage serializer again for normal saves, because it understands the editor document better than regex over HTML.
   - Add a small post-processing normalization step for known bad serializer output only:
     - normalize hard-break markers so they don’t multiply as visible backslashes,
     - preserve headings/lists as Markdown syntax,
     - preserve Markdown links and wikilinks.

2. Add explicit wikilink serialization support
   - Update save serialization so TipTap `wikilink` nodes become Obsidian-compatible Markdown:
     - `[[Title]]` when display text equals the note title,
     - `[[Title|Display]]` when an alias/display text is present.
   - Update the editor load path so existing `[[...]]` content remains visible instead of being flattened or lost.
   - Keep normal URL links as `[text](url)`.

3. Simplify autosave acknowledgment instead of blocking synchronization
   - Replace the current `pendingSaveContentRef` logic with a narrower “last submitted content for this note” acknowledgment.
   - On save success, update that acknowledged value and clear pending state.
   - On React Query refetch, skip `setContent` only when the incoming server content is exactly the save we just submitted or canonically equivalent.
   - Do not block future note updates merely because a pending ref is non-null.

4. Prevent editor resets while actively typing
   - Keep the guard that avoids `editor.commands.setContent(...)` while the editor is focused, unless the note ID changed or an explicit external/AI update arrives.
   - Keep `setContent(..., { emitUpdate: false })` and `setEditable(..., false)` so sync operations do not trigger fake autosaves.

5. Repair the Markdown conversion helpers where needed
   - Keep `markdownToHtml` deterministic for initial loading/source mode, but fix link/wikilink/hard-break cases instead of relying on broad regex behavior.
   - Ensure single-line paragraphs, headings, bullet lists, task lists, normal links, and wikilinks round-trip without data loss.

6. Add regression tests before finishing
   - Add tests for:
     - `# Heading` remains a heading after round-trip,
     - `- bullet` remains a proper bullet without cursor-offset-causing extra breaks,
     - hard-break backslashes do not multiply,
     - `[label](https://...)` remains a visible link,
     - `[[Target]]` and `[[Target|Alias]]` survive editor serialization.
   - Run the relevant tests and TypeScript/build checks.

## Expected result

- Typing `# Heading` stays a heading after autosave.
- Bullets keep the cursor in the correct list item.
- Existing and new links display again.
- Wikilinks remain visible and clickable.
- Edits save and still appear after navigating away and back.
- The app no longer fights active typing with delayed server echo updates.

<lov-actions>
<lov-open-history>View History</lov-open-history>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>