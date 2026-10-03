# Note edits lost around opening a second tab

## Report and scope

Reported on 3 October 2026: after editing text and adding an image, opening the note in a new browser tab showed an older revision and the original editor also reverted. The exact incident's browser requests were not captured. The investigation found reproducible defects consistent with the report, rather than reconstructing its precise network timing.

The file-based Godspeed Mission Control notebook in the product's `codex/godspeed-full-file-based` branch copied the affected editor and requires the same fixes. Its data adapter is different, but its editor lifecycle is shared.

## Confirmed defects

1. Attachment resolution captured the entire editor HTML before awaiting database and signed-image requests. On completion it checked the note id and current focus, but not whether the document had changed. After editing and subsequently blurring the editor, that older HTML could replace both the new text and new image. This happens at mount and at external content loads.
2. The pop-out button immediately navigated the new tab without waiting for the content/title debounce or an in-flight save. The new tab could therefore fetch the prior server revision. On local-first Menerio, a SQLite write is not yet a server upload, so the pop-out must also wait for the upload queue.
3. Visibility/unmount flushing bypassed the serialized autosave path and cleared pending content before success. That allowed concurrent content writes, lost failure retries, and omitted the timestamp acknowledgement that protects against an older refetch.
4. Content saving relied on per-call `mutate` callbacks. Another mutation on the same observer, such as a favorite/title/tag update, could displace the content callbacks and leave its busy flag and queued edits unsettled. Promise-owned completion survives that observer change and unmount.
5. The upstream no-op guard compared edits with the opening baseline even after a different revision had been saved. This could discard a deliberate return to the original text. Godspeed also lacked the upstream guard against saving normalization merely from opening a note.

## Changes

- Apply asynchronous media HTML only when the same immutable ProseMirror document is still current, the same note is open, and the editor is not focused.
- Reserve a blank tab synchronously during the click, then navigate only after content/title saves finish. Close the blank tab and report errors or a stalled save. Preserve the original editor.
- Use the content save queue for visibility/unmount flushing and retain pending edits until success. Explicitly carry the source note id through a note switch.
- Settle content writes through `mutateAsync` promises, including draining queued content after observer replacement or unmount.
- On local-first Menerio, wait for pending uploads before opening the server-backed view.
- Preserve user-triggered reverts while suppressing saves caused only by loading a note.

## Verification

Real Tiptap tests delay media resolution, edit text and insert an image, blur the editor, then release the old response. Both edits survive. Additional tests cover an external document replacement, note switches, ordinary media resolution, pop-out save failure, blocked pop-ups, and save timeout.

The editor integration harness uses real React Query mutations. It covers opening normalization, reverting to opening text after a save, a content save overlapping a favorite mutation and visibility flush, and pending content/title persistence before pop-out navigation. Existing note scheduling checks also run.

Production publishing and installed-package verification are separate from these source/build checks. Record their result before claiming the deployed app is fixed. No private note content is included here.
