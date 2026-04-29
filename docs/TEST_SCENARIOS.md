# Menerio — End-to-End Test Scenarios

> **Last updated:** 2026-04-28

> **Note:** Test accounts must be provisioned per environment. Do not commit real credentials. The personas below use placeholder values — replace them with accounts you create locally or in your Supabase project.

---

## Test Personas

| Persona | Email (example) | Role | Purpose |
|---------|-----------------|------|---------|
| **Free User** | `free@example.test` | `free` | Validates core features and premium gates |
| **Premium User** | `premium@example.test` | `premium` | Validates premium/AI features |
| **Admin User** | `admin@example.test` | `admin` | Validates admin dashboard and user management |

> **Setup:** Create these users via `/auth` signup, then assign roles via Supabase SQL Editor or the Admin panel. Choose strong passwords and store them in your local password manager — never commit them.

---

## Section 1: Authentication & Onboarding

### TS-AUTH-001: Sign Up with Email/Password

- **Objective:** Validate new account creation
- **Preconditions:** No account exists for the test email
- **Steps:**
  1. Navigate to `/auth`
  2. Click the "Sign Up" tab
   3. Enter display name "Test Free User"
   4. Enter a test email and a strong password
   5. Observe password strength indicator updates
   6. Check "I agree to the Terms of Service and Privacy Policy"
   7. Click "Create Account"
- **Expected Outcome:** Toast "Account created!" appears with instruction to check email. Password strength shows "Strong" (4 bars).
- **Variations:** Try weak password (< 8 chars) — strength indicator shows "Too short"

### TS-AUTH-002: Sign In with Email/Password

- **Objective:** Validate login and redirect
- **Preconditions:** Account exists and is confirmed
- **Steps:**
  1. Navigate to `/auth`
  2. Ensure "Sign In" tab is active
  3. Enter email and password for the Free User persona
  4. Click "Sign In"
- **Expected Outcome:** User is redirected to `/dashboard`. Sidebar shows user display name. Role badge shows "Free".
- **Variations:** 
  - Wrong password → toast "Invalid email or password. Please try again."
  - Navigate to `/auth?redirect=/dashboard/notes` → after sign-in, redirected to `/dashboard/notes`

### TS-AUTH-003: Sign In with OAuth (Google / GitHub)

- **Objective:** Validate OAuth sign-in buttons
- **Preconditions:** None
- **Steps:**
  1. Navigate to `/auth`
  2. Click "Continue with Google" button
- **Expected Outcome:** Browser redirects to Google OAuth consent screen. After authorization, user lands on `/dashboard`.
- **Variations:** Repeat with "Continue with GitHub"

### TS-AUTH-004: Password Reset Flow

- **Objective:** Validate forgot-password flow
- **Preconditions:** Account exists
- **Steps:**
  1. Navigate to `/auth`
  2. Click "Forgot your password?" link
  3. Enter email address
  4. Click "Send Reset Link"
- **Expected Outcome:** Toast "Password reset email sent" appears. Email contains link to `/reset-password`.

### TS-AUTH-005: Update Password

- **Objective:** Validate password change in settings
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Scroll to "Change Password" section (or click "Security" tab)
  3. Enter new password with strength ≥ "Good"
  4. Confirm new password
  5. Click "Update Password"
- **Expected Outcome:** Toast "Password updated" appears. User can sign out and sign in with new password.

### TS-AUTH-006: Sign Out

- **Objective:** Validate logout
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Click "Sign Out" button
- **Expected Outcome:** User is redirected to `/auth`. Attempting to navigate to `/dashboard` redirects back to `/auth`.

### TS-AUTH-007: Protected Route Redirect

- **Objective:** Validate unauthenticated access is blocked
- **Preconditions:** User is NOT signed in
- **Steps:**
  1. Navigate directly to `/dashboard`
  2. Navigate directly to `/dashboard/notes`
  3. Navigate directly to `/dashboard/settings`
- **Expected Outcome:** Each navigation redirects to `/auth?redirect=<original_path>`. A loading spinner appears briefly before redirect.

### TS-AUTH-008: First Captures Wizard

- **Objective:** Validate onboarding wizard for new users
- **Preconditions:** User just created account, has 0 notes
- **Steps:**
  1. Sign in as new user
  2. Navigate to `/dashboard`
  3. Observe "First Captures" wizard overlay/card
  4. Follow wizard steps
- **Expected Outcome:** Wizard guides user through creating first notes. Wizard dismisses after completion or manual close.

---

## Section 2: Notes — Full CRUD Lifecycle

### TS-NOTES-001: Create a New Note

- **Objective:** Validate note creation
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Click the "+" (Plus) button to create a new note
  3. Enter title: "E2E Test Note"
  4. Type content in the Tiptap editor: "This is an end-to-end test note with **bold** and *italic* text."
  5. Wait for auto-save (or observe save indicator)
- **Expected Outcome:** Note appears in the note list on the left. Title updates in real-time. Content persists after page refresh.

### TS-NOTES-002: Edit an Existing Note

- **Objective:** Validate note editing and auto-save
- **Preconditions:** At least one note exists
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Click on "E2E Test Note" in the list
  3. Change the title to "E2E Test Note — Updated"
  4. Add a new paragraph: "Updated content with a [task list]."
  5. Use the toolbar to add a task list item
  6. Wait 2 seconds for auto-save
- **Expected Outcome:** Note list updates with new title. Content persists. `updated_at` timestamp changes.

### TS-NOTES-003: Favorite / Unfavorite a Note

- **Objective:** Validate favorite toggle and filter
- **Preconditions:** At least one note exists
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select "E2E Test Note — Updated"
  3. Click the star/favorite icon in the editor header
  4. Switch filter to "Favorites" using the filter dropdown
- **Expected Outcome:** Note appears in Favorites filter. Star icon is filled/active. Clicking again removes from favorites.

### TS-NOTES-004: Pin a Note

- **Objective:** Validate pinned notes appear first
- **Preconditions:** At least 2 notes exist
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select the second note in the list
  3. Pin it via the overflow menu (⋮) → "Pin note"
- **Expected Outcome:** Pinned note moves to the top of the note list. Pin icon visible on the note card.

### TS-NOTES-005: Trash and Restore a Note

- **Objective:** Validate soft-delete and restore flow
- **Preconditions:** At least one note exists
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select a note
  3. Click overflow menu (⋮) → "Move to Trash"
  4. Switch filter to "Trash"
  5. Select the trashed note
  6. Click "Restore" button
- **Expected Outcome:** Note disappears from "All Notes" when trashed. Appears in "Trash" filter. After restore, reappears in "All Notes".

### TS-NOTES-006: Permanently Delete a Note

- **Objective:** Validate hard delete from trash
- **Preconditions:** At least one note in trash
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Switch filter to "Trash"
  3. Select a trashed note
  4. Click "Delete Permanently" button
  5. Confirm in the alert dialog
- **Expected Outcome:** Toast "Note permanently deleted" appears. Note is removed from all views. Cannot be recovered.

### TS-NOTES-007: Rich Text Editing — Toolbar Features

- **Objective:** Validate all editor toolbar capabilities
- **Preconditions:** User has a note open in the editor
- **Steps:**
  1. Select text and apply: Bold, Italic, Underline, Strikethrough
  2. Change text alignment (left, center, right)
  3. Insert a heading (H1, H2, H3)
  4. Create a bullet list and numbered list
  5. Create a task list with checkboxes
  6. Insert a link
  7. Apply text highlight/color
  8. Insert a table
  9. Apply superscript and subscript
- **Expected Outcome:** Each formatting option applies correctly. Content saves and renders properly on page reload.

### TS-NOTES-008: Image Upload in Note

- **Objective:** Validate file upload handling
- **Preconditions:** User has a note open
- **Steps:**
  1. Click the image/attachment button in the toolbar
  2. Upload a test image (PNG, < 5MB)
  3. Wait for upload to complete
- **Expected Outcome:** Image appears inline in the note content. Image is stored in `note-attachments` bucket. Media analysis is triggered (pending status).

### TS-NOTES-009: Wikilink Autocomplete

- **Objective:** Validate `[[wikilink]]` syntax and autocomplete
- **Preconditions:** At least 2 notes exist
- **Steps:**
  1. Open a note in the editor
  2. Type `[[` to trigger autocomplete
  3. Start typing the title of another note
  4. Select from the autocomplete dropdown
- **Expected Outcome:** Autocomplete popover appears with matching notes. Selecting inserts a wikilink. The link is clickable and navigates to the target note.

### TS-NOTES-010: Search — ILIKE (Exact Match)

- **Objective:** Validate instant text search
- **Preconditions:** Multiple notes with distinct content
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Click the search icon
  3. Type "E2E Test" in the search field
  4. Ensure search mode is "Exact" (Type icon)
- **Expected Outcome:** Notes matching the query appear instantly. Results filter as user types. Clearing search restores full list.

### TS-NOTES-011: Search — Semantic (AI-powered)

- **Objective:** Validate vector-based semantic search
- **Preconditions:** Notes exist with embeddings (processed via AI)
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Click the search icon
  3. Switch to "Semantic" search mode (Brain icon)
  4. Type a conceptual query like "personal goals for this year"
  5. Wait for results
- **Expected Outcome:** Results appear ranked by similarity score. Results may include notes that don't contain the exact words. AI credits are deducted.
- **Variations:** Test scope filter: "All", "Notes only", "Media only"

### TS-NOTES-012: Filter Notes by Entity Type

- **Objective:** Validate entity-type filter dropdown
- **Preconditions:** Notes exist with different entity types (Observation, Task, Idea, etc.)
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Click the filter/entity-type dropdown
  3. Select "Task"
- **Expected Outcome:** Only notes with `entity_type = "Task"` are shown. Clearing filter shows all notes.

### TS-NOTES-013: Download Note as Markdown

- **Objective:** Validate single-note Markdown export
- **Preconditions:** A note exists with title, Markdown content, tags, and optional wikilinks
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select the note
  3. Click the download icon in the editor action bar
- **Expected Outcome:** Browser downloads a `.md` file named after the note title. File contains YAML frontmatter and the current Markdown body.

### TS-NOTES-014: Source Mode Round Trip

- **Objective:** Validate Markdown source editing
- **Preconditions:** A note is open and editable
- **Steps:**
  1. Click the Markdown source icon
  2. Edit raw Markdown, including a checklist or wikilink
  3. Switch back to rich text mode
  4. Refresh the page
- **Expected Outcome:** Markdown changes persist without HTML conversion artifacts. Checklists and wikilinks render correctly.

### TS-NOTES-013: Process Note with AI

- **Objective:** Validate AI note processing (tagging, classification)
- **Preconditions:** User has AI credits. A note with substantive content exists.
- **Steps:**
  1. Open a note with at least 2 paragraphs of content
  2. Click "Process with AI" (Sparkles icon) in the editor toolbar/menu
  3. Wait for processing to complete
- **Expected Outcome:** Note metadata is populated: entity_type, tags, topics, people, sentiment, summary. Smart Tags panel shows extracted data. AI credits are deducted.

### TS-NOTES-014: External Note — Read-Only Toolbar

- **Objective:** Validate that external (synced) notes show a simplified read-only action bar instead of the full editor toolbar
- **Preconditions:** An external note exists (synced from Querino via `receive-note`)
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select an external note (identified by the orange source-app badge)
  3. Observe the toolbar area above the editor content
- **Expected Outcome:** No rich-text formatting toolbar (bold, italic, headings, etc.) is shown. Instead, a read-only bar displays: 🔒 lock icon, "Read-only · Synced from {source_app}" label, "Open in {app}" button (if `source_url` exists), and "Duplicate to Menerio" button.

### TS-NOTES-015: External Note — Open in Source App

- **Objective:** Validate one-click jump to the originating app
- **Preconditions:** An external note with a `source_url` exists
- **Steps:**
  1. Open the external note
  2. Click "Open in {app}" button in the read-only bar
- **Expected Outcome:** A new browser tab opens with the `source_url`, navigating to the note in Querino.

### TS-NOTES-016: External Note — Duplicate to Local Note

- **Objective:** Validate duplicating an external note to create a local editable copy
- **Preconditions:** An external note exists
- **Steps:**
  1. Open the external note
  2. Click "Duplicate to Menerio" in the read-only bar
  3. Wait for the duplication to complete
- **Expected Outcome:** Toast "Duplicated to a local note" appears. User is navigated to the new note. The new note title is "{original title} (copy)", has the same content and tags, and is NOT external (full editor toolbar is visible, note is editable).

### TS-NOTES-017: External Note — Structured Fields & Patch

- **Objective:** Validate the External Note Panel for viewing/editing structured fields
- **Preconditions:** An external note with structured fields exists
- **Steps:**
  1. Open the external note
  2. Scroll to the External Note Panel (sync status, structured fields, related items)
  3. Click the pencil icon next to a structured field
  4. Edit the value and press Enter
- **Expected Outcome:** A patch request is sent to the source app. Loading spinner appears during the request. Success toast confirms the patch was sent.

---

## Section 3: Note Sharing

### TS-SHARE-001: Share a Note (Generate Public Link)

- **Objective:** Validate Evernote-style public sharing
- **Preconditions:** User has at least one note
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Select a note
  3. Click overflow menu (⋮) → "Share Note"
  4. Observe clipboard notification
- **Expected Outcome:** Toast "Public link copied to clipboard" appears. A "Shared" badge (globe icon) appears in the editor header. The overflow menu now shows "Copy Public Link" and "Stop Sharing" instead of "Share Note".

### TS-SHARE-002: Access Shared Note as Anonymous User

- **Objective:** Validate public note viewer
- **Preconditions:** A note has been shared (TS-SHARE-001)
- **Steps:**
  1. Copy the shared URL from clipboard
  2. Open an incognito/private browser window
  3. Paste and navigate to the shared URL (format: `/shared/<token>`)
- **Expected Outcome:** Note renders in a clean, read-only view showing title, content, tags, and dates. No login required. "Powered by Menerio" branding visible. No edit controls.

### TS-SHARE-003: Stop Sharing a Note

- **Objective:** Validate share revocation
- **Preconditions:** A note is currently shared
- **Steps:**
  1. Open the shared note in the editor
  2. Click overflow menu (⋮) → "Stop Sharing"
  3. In incognito window, try to access the previously shared URL
- **Expected Outcome:** "Shared" badge disappears from editor. The public URL now shows "Note not found" or 404 state.

---

## Section 4: Contacts (People)

### TS-PEOPLE-001: Create a Contact

- **Objective:** Validate contact creation
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/people`
  2. Click "Add Contact" (Plus icon) button
  3. Fill in: Name "Jane Doe", Email "jane@example.com", Company "Acme Corp", Role "CTO", Relationship "Professional"
  4. Click "Save" / submit
- **Expected Outcome:** Contact card appears in the list. All fields display correctly.

### TS-PEOPLE-002: View Contact Detail

- **Objective:** Validate contact detail view with interactions
- **Preconditions:** At least one contact exists
- **Steps:**
  1. Navigate to `/dashboard/people`
  2. Click on "Jane Doe" contact card
- **Expected Outcome:** Detail view shows all contact fields, interaction history, and linked notes.

### TS-PEOPLE-003: Edit a Contact

- **Objective:** Validate contact update
- **Preconditions:** At least one contact exists
- **Steps:**
  1. Open contact detail for "Jane Doe"
  2. Edit the role to "VP Engineering"
  3. Add a tag
  4. Save changes
- **Expected Outcome:** Updated fields persist after refresh.

### TS-PEOPLE-004: Delete a Contact

- **Objective:** Validate contact deletion
- **Preconditions:** At least one contact exists
- **Steps:**
  1. Open contact detail
  2. Click Delete (Trash icon)
  3. Confirm deletion
- **Expected Outcome:** Contact is removed from the list. Associated interactions are cascade-deleted.

### TS-PEOPLE-005: Search Contacts

- **Objective:** Validate contact search
- **Preconditions:** Multiple contacts exist
- **Steps:**
  1. Navigate to `/dashboard/people`
  2. Type "Jane" in the search field
- **Expected Outcome:** Only contacts matching "Jane" are shown.

### TS-PEOPLE-006: Log a Contact Interaction

- **Objective:** Validate interaction logging
- **Preconditions:** At least one contact exists
- **Steps:**
  1. Open contact detail
  2. Click "Log Interaction" or similar button
  3. Select type (e.g., "Meeting"), enter summary, set date
  4. Save
- **Expected Outcome:** Interaction appears in the contact's interaction history with correct date and type.

### TS-PEOPLE-007: Merge Duplicate Contacts

- **Objective:** Validate contact merge flow
- **Preconditions:** Two contacts exist that represent the same person (e.g. "Jane Doe" and "Jane D.")
- **Steps:**
  1. Navigate to `/dashboard/people`
  2. Open one of the duplicates and observe the Duplicate Hints suggestion
  3. Click "Merge" and pick the canonical contact
  4. Confirm the merge dialog
- **Expected Outcome:** Source contact is marked `merged_into` the target. Notes, interactions, profile entries, and relationships re-point to the canonical contact. Source no longer appears in the People list.

### TS-PEOPLE-008: Contact Profile Tab — Seed & Edit Categories

- **Objective:** Validate per-contact profile system
- **Preconditions:** A contact exists with no profile categories yet
- **Steps:**
  1. Open the contact detail and switch to the "Profile" tab
  2. Wait for default categories to auto-seed
  3. Add an entry under "Identity & Basics" (label: "Hometown", value: "Berlin")
  4. Add a custom category "Side Projects" with scope "Professional"
  5. Edit and delete an entry
- **Expected Outcome:** Default categories appear automatically. Entries persist. Profile completeness ring updates. Custom categories show scope badges.

### TS-PEOPLE-009: Contact Profile Suggestions from Notes

- **Objective:** Validate AI suggestions for a specific contact
- **Preconditions:** Multiple notes mention the contact by name. AI credits available.
- **Steps:**
  1. Open the contact's Profile tab
  2. Trigger "Suggest from notes" (or save a note that mentions the contact to fire `process-note`)
  3. Open `/dashboard/review-queue`
- **Expected Outcome:** `add_profile_entry` items for that contact appear in the Review Queue with category, label, value, and source note link.

---

## Section 5: People Relationships

### TS-REL-001: Add a Relationship Manually (Contact ↔ Contact)

- **Objective:** Validate manual relationship creation between two contacts
- **Preconditions:** At least two contacts exist (e.g. "Max" and "Michael")
- **Steps:**
  1. Open Max's contact, switch to the Profile tab
  2. Locate the "Relationships" section at the top
  3. Click "Add"
  4. Pick label "employee", target type "A contact", target person "Michael"
  5. Click "Add"
- **Expected Outcome:** Relationship row appears showing "→ employee — Michael" with a clickable link to Michael's contact. Toast "Relationship saved".

### TS-REL-002: Add a Self-Relationship

- **Objective:** Validate relationships involving the logged-in user
- **Preconditions:** At least one contact exists
- **Steps:**
  1. Open a contact's Profile tab
  2. In Relationships, click "Add"
  3. Pick label "mentor", target type "Me ({your name})"
  4. Save
- **Expected Outcome:** Row shows the user's display name as the linked target, navigating to `/dashboard/profile`. The same relationship is visible from the user's own Profile page (mirrored perspective).

### TS-REL-003: Custom Relationship Label

- **Objective:** Validate the custom label override
- **Preconditions:** Two contacts exist
- **Steps:**
  1. Add a relationship and type a value into the "Custom label" field (e.g. "rowing partner")
  2. Save
- **Expected Outcome:** The custom label is shown in the badge instead of the standard one.

### TS-REL-004: Edit and Delete a Relationship

- **Objective:** Validate edit / delete actions
- **Preconditions:** At least one relationship exists
- **Steps:**
  1. Hover the relationship row
  2. Click pencil → change label → Update
  3. Click trash → confirm
- **Expected Outcome:** Edit updates label and persists. Delete removes the row and the inverse paired record (if any).

### TS-REL-005: Perspective-Aware Display

- **Objective:** Validate that labels invert when viewed from the other side
- **Preconditions:** A relationship "Max → employee → Michael" exists
- **Steps:**
  1. View Max's profile — observe the displayed label
  2. View Michael's profile — observe the displayed label
- **Expected Outcome:** Max's profile shows "employer — Michael". Michael's profile shows "employee — Max". Same row, opposite perspectives.

### TS-REL-006: LLM-Suggested Relationship via Review Queue

- **Objective:** Validate AI extraction of relationships into the Review Queue
- **Preconditions:** AI credits available; two contacts (or names) exist
- **Steps:**
  1. Create or edit a note containing wording like "Max is Michael's employee"
  2. Save and wait for `process-note` to finish
  3. Open `/dashboard/review-queue`
- **Expected Outcome:** An `add_relationship` suggestion appears with the proposed label pair and the two people. Accepting it creates the forward record and queues the inverse "suggested mirror" suggestion.

### TS-REL-007: Relationship Deduplication

- **Objective:** Validate the system prevents duplicate edges
- **Preconditions:** A relationship "Max ↔ Michael (employee)" already exists
- **Steps:**
  1. Try to add the exact same relationship again from the UI
- **Expected Outcome:** Toast "This relationship already exists". No duplicate row is created.

---

## Section 6: Review Queue

### TS-RQ-001: Open Review Queue

- **Objective:** Validate page renders and badge syncs
- **Preconditions:** AI has produced at least one pending suggestion
- **Steps:**
  1. Observe the sidebar — "Review Queue" should show a numeric badge
  2. Navigate to `/dashboard/review-queue`
- **Expected Outcome:** Pending items list renders. Sidebar badge count matches the list count. Both refresh roughly every 60 seconds.

### TS-RQ-002: Accept an `add_contact` Suggestion

- **Objective:** Validate contact creation via Review Queue
- **Preconditions:** A pending `add_contact` item exists
- **Steps:**
  1. Click "Accept" on the suggestion
- **Expected Outcome:** New contact created. People page updates immediately (React Query cache invalidated). Item moves out of the pending list.

### TS-RQ-003: Accept an `add_alias` Suggestion

- **Objective:** Validate alias merging into an existing contact
- **Preconditions:** A pending `add_alias` item references an existing contact
- **Steps:**
  1. Accept the suggestion
- **Expected Outcome:** The alias is appended to the contact's `aliases` array (no duplicates).

### TS-RQ-004: Accept an `add_profile_entry` Suggestion

- **Objective:** Validate profile fact insertion
- **Preconditions:** A pending `add_profile_entry` item exists for self or a contact
- **Steps:**
  1. Accept the suggestion
- **Expected Outcome:** Default categories are seeded for the target if missing. The entry is inserted under the suggested category. Profile completeness updates.

### TS-RQ-005: Accept an `add_event` Suggestion

- **Objective:** Validate calendar/event extraction
- **Preconditions:** A pending `add_event` item exists
- **Steps:**
  1. Accept the suggestion
- **Expected Outcome:** Event is created (or forwarded according to feature config). Item resolves.

### TS-RQ-006: Accept an `add_relationship` Suggestion (Mirror)

- **Objective:** Validate the suggested-mirror workflow
- **Preconditions:** A pending `add_relationship` suggestion exists
- **Steps:**
  1. Accept it
  2. Stay on the Review Queue page
- **Expected Outcome:** The forward relationship row is inserted in `contact_relationships`. A new pending item for the inverse relationship appears in the Review Queue for the other person.

### TS-RQ-007: Skip vs. Never

- **Objective:** Validate the three-option resolution model
- **Preconditions:** Pending suggestions exist
- **Steps:**
  1. Click "Skip" on one item
  2. Click "Never" on another item
- **Expected Outcome:** "Skip" removes from pending but leaves room to be re-suggested. "Never" dismisses permanently — re-running extraction does not re-create the same item (deduplication via `uq_review_queue_pending`).

### TS-RQ-008: Source Note Link

- **Objective:** Validate traceability back to the note
- **Preconditions:** A suggestion has a `source_note_id`
- **Steps:**
  1. Click the source-note link on the suggestion card
- **Expected Outcome:** Navigates to `/dashboard/notes/<id>` with the source note open.

---

## Section 7: Action Items

### TS-ACTIONS-001: Create an Action Item

- **Objective:** Validate action item creation
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/actions`
  2. Click "Add Action" (Plus icon)
  3. Enter content: "Follow up with Jane about the project proposal"
  4. Set priority to "High"
  5. Set due date to tomorrow
  6. Click Save
- **Expected Outcome:** Action item appears in the list with "High" priority badge, due date, and "Open" status.

### TS-ACTIONS-002: Complete an Action Item

- **Objective:** Validate status transition
- **Preconditions:** At least one open action item exists
- **Steps:**
  1. Navigate to `/dashboard/actions`
  2. Click the status icon/checkbox on an action item to mark it complete
- **Expected Outcome:** Status changes to "Done" with a checkmark icon. `completed_at` timestamp is set.

### TS-ACTIONS-003: Filter Actions by Status and Priority

- **Objective:** Validate action filtering
- **Preconditions:** Multiple action items with different statuses and priorities
- **Steps:**
  1. Navigate to `/dashboard/actions`
  2. Use the status filter to show only "Open" items
  3. Use the priority filter to show only "High" priority
- **Expected Outcome:** List filters correctly. Counts update.

### TS-ACTIONS-004: Delete an Action Item

- **Objective:** Validate action deletion
- **Preconditions:** At least one action item exists
- **Steps:**
  1. Navigate to `/dashboard/actions`
  2. Click delete on an action item
  3. Confirm deletion
- **Expected Outcome:** Item is removed from the list.

---

## Section 8: Groups

### TS-GROUPS-001: Create a Group from Template

- **Objective:** Validate group creation and template defaults
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/groups`
  2. Create a new Group using the Dream 100 template
  3. Enter name, purpose, and description
- **Expected Outcome:** Group is created with slug, stages, template fields, and default goals. User lands on `/dashboard/groups/<slug>`.

### TS-GROUPS-002: Add and Move Group Members

- **Objective:** Validate membership lifecycle
- **Preconditions:** A group and at least one contact exist
- **Steps:**
  1. Open the group detail page
  2. Add an existing person as a member
  3. Move the member between pipeline stages
  4. Open the member sheet
- **Expected Outcome:** Membership appears in Pipeline and List views. Stage, position, priority, reason, notes, and next-step area persist.

### TS-GROUPS-003: Import Members from Structured Note

- **Objective:** Validate deterministic table/list import
- **Preconditions:** A note exists with a Markdown table or numbered list containing names, links, relevance, and first steps
- **Steps:**
  1. Open a matching group
  2. Run the AI/member suggestion import from notes
  3. Confirm/import suggested rows
- **Expected Outcome:** Members are created or matched without duplicates. Order is preserved in `position`; extracted links, relevance, and first steps are saved on membership attributes.

### TS-GROUPS-004: Generate Group Briefing

- **Objective:** Validate AI briefing generation
- **Preconditions:** Group has members, notes, and interactions
- **Steps:**
  1. Open the Briefing tab
  2. Generate a briefing
- **Expected Outcome:** Briefing appears with recent movement, stale members, priorities, and suggested next actions. AI credits are deducted.

### TS-GROUPS-005: Group Lexicon Link

- **Objective:** Validate operational group ↔ synthesized Lexicon page navigation
- **Preconditions:** A group exists with a Lexicon page
- **Steps:**
  1. Open the Group About tab
  2. Click the Lexicon link
  3. From the Lexicon group page, click “View as Group”
- **Expected Outcome:** Navigation works in both directions without losing slug state.

---

## Section 9: Lexicon

### TS-LEXICON-001: Open Lexicon Index

- **Objective:** Validate Lexicon index rendering
- **Preconditions:** User has at least one Lexicon page
- **Steps:**
  1. Navigate to `/lexicon`
- **Expected Outcome:** Pages are grouped by type and can be opened by slug.

### TS-LEXICON-002: View Lexicon Page Sources and Backlinks

- **Objective:** Validate source traceability and backlinks
- **Preconditions:** A Lexicon page has at least one source note and one incoming link
- **Steps:**
  1. Open `/lexicon/<slug>`
  2. Inspect Sources and Backlinks sections
  3. Open a source note
- **Expected Outcome:** Sources show note title/date/content preview and navigate to the source note. Backlinks navigate to linking pages.

### TS-LEXICON-003: Edit Lexicon Page and View Revision

- **Objective:** Validate manual edits and revision audit trail
- **Preconditions:** A Lexicon page exists
- **Steps:**
  1. Click Edit
  2. Change content and save
  3. Open revisions
- **Expected Outcome:** Content saves, a `manual_edit` revision appears, and diff view shows previous/new content.

### TS-LEXICON-004: Legacy Wiki Redirects

- **Objective:** Validate backwards compatibility
- **Steps:**
  1. Navigate to `/wiki`
  2. Navigate to `/wiki/example-slug`
- **Expected Outcome:** Routes redirect to `/lexicon` and `/lexicon/example-slug`.

---

## Section 10: Knowledge Graph

### TS-GRAPH-001: View Knowledge Graph

- **Objective:** Validate graph rendering
- **Preconditions:** User has multiple notes with connections
- **Steps:**
  1. Navigate to `/dashboard/graph`
  2. Wait for graph to load
- **Expected Outcome:** Interactive force-directed graph renders with nodes (notes) and edges (connections). Node labels show note titles.

### TS-GRAPH-002: Search and Filter Graph

- **Objective:** Validate graph search
- **Preconditions:** Graph has loaded
- **Steps:**
  1. Type a note title in the graph search field
  2. Observe highlighted node
- **Expected Outcome:** Matching node is highlighted/focused. Graph pans to center the found node.

### TS-GRAPH-003: Click Graph Node to Open Note

- **Objective:** Validate graph → note navigation
- **Preconditions:** Graph has loaded
- **Steps:**
  1. Click on a node in the graph
  2. Click "Open Note" or the external link icon
- **Expected Outcome:** Browser navigates to `/dashboard/notes/<noteId>` with the note open in the editor.

### TS-GRAPH-004: Orphan Notes Detection

- **Objective:** Validate orphan note detection panel
- **Preconditions:** At least one note with no connections exists
- **Steps:**
  1. Navigate to `/dashboard/graph`
  2. Observe the Orphan Notes panel
- **Expected Outcome:** Orphan notes are listed. Clicking one navigates to the note.

### TS-GRAPH-005: Export Graph Data

- **Objective:** Validate graph export
- **Preconditions:** Graph has loaded
- **Steps:**
  1. Click the "Export" button on the graph page
  2. Select export format
- **Expected Outcome:** Graph data downloads in the selected format.

---

## Section 11: Media Library

### TS-MEDIA-001: View Media Library

- **Objective:** Validate media library page
- **Preconditions:** User has notes with embedded images or PDFs
- **Steps:**
  1. Navigate to `/dashboard/media`
  2. Observe the grid of media items
- **Expected Outcome:** Grid shows thumbnails with AI descriptions and parent note titles. Status bar shows "X analyzed, Y pending, Z failed".

### TS-MEDIA-002: Search Media by Content

- **Objective:** Validate media-specific search
- **Preconditions:** Media items with completed analysis exist
- **Steps:**
  1. Navigate to `/dashboard/media`
  2. Type a search query in the search bar (e.g., "screenshot")
- **Expected Outcome:** Media items matching the query are shown. Search filters by description, topics, and extracted text.

### TS-MEDIA-003: Filter Media by Type

- **Objective:** Validate media type filtering
- **Preconditions:** Media items of different types exist
- **Steps:**
  1. Navigate to `/dashboard/media`
  2. Use the content type filter dropdown
  3. Select "Image"
- **Expected Outcome:** Only image-type media items are shown.

### TS-MEDIA-004: Click Media to Navigate to Parent Note

- **Objective:** Validate media → note navigation
- **Preconditions:** At least one analyzed media item exists
- **Steps:**
  1. Navigate to `/dashboard/media`
  2. Click on a media item card
- **Expected Outcome:** Browser navigates to `/dashboard/notes/<parentNoteId>`.

### TS-MEDIA-005: Batch Media Analysis (Backfill)

- **Objective:** Validate batch analysis trigger
- **Preconditions:** Unanalyzed media exists
- **Steps:**
  1. Navigate to `/dashboard/media`
  2. Click "Analyze All" or batch analysis button
  3. Wait for processing
- **Expected Outcome:** Pending items transition to "analyzing" then "complete". Progress indicator updates. AI credits are deducted.

---

## Section 12: Weekly Review

### TS-REVIEW-001: Generate Weekly Review

- **Objective:** Validate AI-powered weekly review
- **Preconditions:** User has notes created in the past week. AI credits available.
- **Steps:**
  1. Navigate to `/dashboard/review`
  2. Select the current week
  3. Click "Generate Review" (Sparkles icon)
  4. Wait for AI processing
- **Expected Outcome:** Review card displays with summary, trends, and highlights from the week's notes. AI credits deducted.

### TS-REVIEW-002: View Past Reviews

- **Objective:** Validate review history
- **Preconditions:** At least one review has been generated
- **Steps:**
  1. Navigate to `/dashboard/review`
  2. Browse to a previous week
- **Expected Outcome:** Previously generated review loads and displays.

---

## Section 13: User Profile System

### TS-PROFILE-001: Seed Default Categories

- **Objective:** Validate auto-seeding on first visit
- **Preconditions:** User has never visited profile page (no categories exist)
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Observe welcome state / initial seeding
- **Expected Outcome:** Default categories are created: Identity & Basics, Professional Life, Health & Body, Values & Principles, Goals & Aspirations, Preferences & Quirks. Completeness indicator shows 0%.

### TS-PROFILE-002: Add a Profile Entry

- **Objective:** Validate entry creation
- **Preconditions:** Profile categories are seeded
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Find "Identity & Basics" category
  3. Click "Add Entry" button
  4. Enter label "Full Name", value "Test User"
  5. Optionally link a note
  6. Save
- **Expected Outcome:** Entry appears under the category. Completeness percentage increases.

### TS-PROFILE-003: Edit a Profile Entry

- **Objective:** Validate entry update
- **Preconditions:** At least one entry exists
- **Steps:**
  1. Click edit on the entry
  2. Change value to "Test User Updated"
  3. Save
- **Expected Outcome:** Value updates and persists.

### TS-PROFILE-004: Delete a Profile Entry

- **Objective:** Validate entry deletion
- **Preconditions:** At least one entry exists
- **Steps:**
  1. Click delete icon on an entry
  2. Confirm deletion
- **Expected Outcome:** Entry is removed. Completeness percentage updates.

### TS-PROFILE-005: Add a Custom Category

- **Objective:** Validate custom category creation
- **Preconditions:** Profile page is loaded
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Click "Add Category" button
  3. Enter name "Hobbies", select icon, select scope "Personal"
  4. Save
- **Expected Outcome:** New "Hobbies" category appears in the list with a "Personal" scope badge.

### TS-PROFILE-006: Delete a Category

- **Objective:** Validate category deletion
- **Preconditions:** A custom (non-default) category exists
- **Steps:**
  1. Click delete on the "Hobbies" category
  2. Confirm deletion
- **Expected Outcome:** Category and all its entries are removed.

### TS-PROFILE-007: Profile Completeness Indicator

- **Objective:** Validate completeness ring and messages
- **Preconditions:** Various entry states
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Observe the circular progress ring at top
  3. Add entries to empty categories and watch percentage change
- **Expected Outcome:** 
  - 0-20%: "Just getting started — every entry helps AI understand you better"
  - 21-50%: "Nice progress! Your agents are getting to know you"
  - 51-80%: "Looking great — your AI context is getting rich"
  - 81-100%: "Impressive! Your agents have excellent context about who you are"
  - Empty categories shown as clickable links

### TS-PROFILE-008: Agent Instructions — Add

- **Objective:** Validate agent instruction creation
- **Preconditions:** Profile page loaded
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Click "Agent Instructions" tab
  3. Click "Add instruction" area
  4. Enter: "Always address me informally"
  5. Set scope to "All agents"
  6. Save
- **Expected Outcome:** Instruction card appears with text and "All" scope badge. Active toggle is on.

### TS-PROFILE-009: Agent Instructions — Toggle Active

- **Objective:** Validate instruction enable/disable
- **Preconditions:** At least one instruction exists
- **Steps:**
  1. Click the active/inactive toggle on an instruction
- **Expected Outcome:** Instruction visual state changes (dimmed if inactive). `is_active` persists after refresh.

### TS-PROFILE-010: Agent Instructions — Delete

- **Objective:** Validate instruction deletion
- **Preconditions:** At least one instruction exists
- **Steps:**
  1. Click delete on an instruction
- **Expected Outcome:** Instruction is removed from the list.

### TS-PROFILE-011: Export Tab — Generate Profile Text

- **Objective:** Validate profile export generation
- **Preconditions:** User has profile entries and instructions
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Click "Export & Share" tab
  3. Select format: "Markdown"
  4. Toggle scope filters
  5. Toggle "Include linked note content"
  6. Click "Copy to Clipboard"
- **Expected Outcome:** Live preview updates in real-time. Clipboard contains formatted profile text. Toast confirms copy.
- **Variations:** Test all formats: Structured Text, Markdown, XML

### TS-PROFILE-012: Profile Suggestions from Notes

- **Objective:** Validate AI-generated profile suggestions
- **Preconditions:** User has 10+ notes with varied content. AI credits available.
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Click "Suggest entries from my notes" button
  3. Wait for analysis
- **Expected Outcome:** Suggestion cards appear with proposed entries, each showing category, label, value, confidence, and source note link. User can accept (adds entry) or dismiss.

---

## Section 14: Dashboard

### TS-DASH-001: Dashboard Overview Cards

- **Objective:** Validate dashboard data display
- **Preconditions:** User has notes, AI credits, and profile entries
- **Steps:**
  1. Navigate to `/dashboard`
- **Expected Outcome:** Dashboard shows: greeting with display name, role badge, note count card, AI credits card (remaining/total), profile completeness card with mini progress ring.

### TS-DASH-002: Quick Capture from Dashboard

- **Objective:** Validate quick note creation
- **Preconditions:** User is on dashboard
- **Steps:**
  1. Click "New Note" or Quick Capture button on dashboard
- **Expected Outcome:** Navigates to `/dashboard/notes` with a new blank note created and selected.

### TS-DASH-003: Getting Started Checklist

- **Objective:** Validate onboarding checklist
- **Preconditions:** New user with few notes
- **Steps:**
  1. Navigate to `/dashboard`
  2. Observe the getting started checklist
  3. Complete items and observe progress
  4. Click dismiss (X) button
- **Expected Outcome:** Checklist tracks progress. Dismissing sets `menerio-checklist-dismissed` in localStorage. Checklist doesn't reappear.

### TS-DASH-004: Activity Feed

- **Objective:** Validate recent activity display
- **Preconditions:** User has performed actions (created notes, etc.)
- **Steps:**
  1. Navigate to `/dashboard`
  2. Scroll to Activity Feed section
- **Expected Outcome:** Recent activities listed with action type, item, and timestamp.

### TS-DASH-005: Profile Widget on Dashboard

- **Objective:** Validate profile integration card
- **Preconditions:** User has some profile entries
- **Steps:**
  1. Navigate to `/dashboard`
  2. Observe "Profile" card widget
- **Expected Outcome:** Shows completeness %, entry count, active instruction count, "View profile" link. If < 50%, shows CTA: "A richer profile means better AI interactions".

---

## Section 15: AI Features & Credit Tracking

### TS-AI-001: View AI Credits

- **Objective:** Validate credits display
- **Preconditions:** User is signed in with an active allowance period
- **Steps:**
  1. Navigate to `/dashboard/settings?tab=credits` (or Credits section)
  2. Observe credit display
- **Expected Outcome:** Shows credits used / credits granted, remaining credits, period dates, and usage history.

### TS-AI-002: AI Credits Gate — Sufficient Credits

- **Objective:** Validate AI operations succeed with credits
- **Preconditions:** User has remaining credits > 0
- **Steps:**
  1. Open a note
  2. Click "Process with AI"
- **Expected Outcome:** Processing succeeds. Credits balance decreases. Credits display refreshes.

### TS-AI-003: AI Credits Gate — Exhausted Credits

- **Objective:** Validate AI operations blocked when out of credits
- **Preconditions:** User has 0 remaining credits
- **Steps:**
  1. Attempt to process a note with AI
- **Expected Outcome:** Toast "Out of AI credits" with description about waiting for next billing cycle. Operation does not proceed.

### TS-AI-004: AI Credits Gate — No Credits Plan

- **Objective:** Validate free tier with 0 granted credits
- **Preconditions:** User's allowance period has `tokens_granted = 0`
- **Steps:**
  1. Attempt semantic search or AI processing
- **Expected Outcome:** Toast "No AI credits available" with message to contact admin or upgrade.

### TS-AI-005: Note Chat (AI Assistant)

- **Objective:** Validate per-note AI chat
- **Preconditions:** User has AI credits. A note with content is open.
- **Steps:**
  1. Open a note
  2. Open the Chat panel (message icon)
  3. Type a question about the note content
  4. Submit
- **Expected Outcome:** AI responds with context-aware answer based on note content. Response appears in chat panel. Credits deducted.

---

## Section 16: Premium Feature Gating

### TS-PREMIUM-001: Premium Gate — Free User Blocked

- **Objective:** Validate premium features are locked for free users
- **Preconditions:** Signed in as Free User persona
- **Steps:**
  1. Navigate to any premium-gated feature (wrapped in `<PremiumGate>`)
- **Expected Outcome:** Lock icon card displayed: "Premium Feature" with message "This feature requires a premium role. Contact an administrator to request access."

### TS-PREMIUM-002: Premium Gate — Premium User Access

- **Objective:** Validate premium features accessible to premium users
- **Preconditions:** Signed in as Premium User persona
- **Steps:**
  1. Navigate to the same premium-gated feature
- **Expected Outcome:** Feature renders normally without any gate.

---

## Section 17: Settings & Integrations

### TS-SETTINGS-001: Update Profile Info

- **Objective:** Validate profile update in settings
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Change display name to "E2E Test User"
  3. Update bio
  4. Click "Save Changes"
- **Expected Outcome:** Toast "Profile updated" appears. Changes persist on refresh. Sidebar shows updated name.

### TS-SETTINGS-002: Upload Avatar

- **Objective:** Validate avatar upload
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Click avatar/camera icon
  3. Upload a small image
- **Expected Outcome:** Avatar updates immediately. Stored in `avatars` bucket. Visible in sidebar and settings.

### TS-SETTINGS-003: MCP Connection Manager

- **Objective:** Validate MCP setup instructions
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings?tab=mcp` (or AI Tools tab)
  2. Observe MCP configuration instructions
  3. Observe "Tip: Make sure your profile is filled in..." message
- **Expected Outcome:** MCP endpoint URL and access key are displayed. Copy buttons work. Profile tip banner visible.

### TS-SETTINGS-004: GitHub Sync Settings

- **Objective:** Validate GitHub integration configuration
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Go to GitHub Sync section
  3. Enter GitHub token, repo owner, repo name
  4. Save configuration
- **Expected Outcome:** Connection saves. Sync status displays.

### TS-SETTINGS-005: Notification Preferences

- **Objective:** Validate notification settings
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Go to Notifications section
  3. Toggle daily digest, weekly review notifications
  4. Set digest time
  5. Save
- **Expected Outcome:** Preferences persist. Toggles reflect saved state on reload.

### TS-SETTINGS-006: Import / Migrate Data

- **Objective:** Validate data import UI
- **Preconditions:** User is signed in
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Go to Import section
  3. Observe import options
- **Expected Outcome:** Import interface loads with supported format options.

### TS-SETTINGS-007: Delete Account

- **Objective:** Validate account deletion flow
- **Preconditions:** User is signed in (use a disposable test account)
- **Steps:**
  1. Navigate to `/dashboard/settings`
  2. Scroll to "Danger Zone" / "Delete Account"
  3. Click delete button
  4. Type confirmation text
  5. Click final confirm
- **Expected Outcome:** Account and all data deleted. User is signed out and redirected to `/auth`.

---

## Section 18: Admin Dashboard

### TS-ADMIN-001: Access Admin Panel

- **Objective:** Validate admin route protection
- **Preconditions:** Signed in as Admin persona
- **Steps:**
  1. Navigate to `/dashboard/admin`
- **Expected Outcome:** Admin dashboard loads with Users, Stats, and Settings tabs.

### TS-ADMIN-002: Admin Route Blocked for Non-Admin

- **Objective:** Validate admin access denied
- **Preconditions:** Signed in as Free or Premium user
- **Steps:**
  1. Navigate to `/dashboard/admin`
- **Expected Outcome:** "Access Denied" message with ShieldAlert icon. User is redirected to `/dashboard`.

### TS-ADMIN-003: View All Users

- **Objective:** Validate user management table
- **Preconditions:** Signed in as Admin
- **Steps:**
  1. Navigate to `/dashboard/admin`
  2. Observe users table
  3. Search for a user by name
- **Expected Outcome:** Table shows all users with display name, email, role badge, avatar, and created date. Search filters results.

### TS-ADMIN-004: Change User Role

- **Objective:** Validate role assignment
- **Preconditions:** Signed in as Admin
- **Steps:**
  1. Navigate to `/dashboard/admin`
  2. Find a test user in the table
  3. Click edit/role dropdown
  4. Change role from "free" to "premium"
  5. Save
- **Expected Outcome:** Role badge updates. User now has premium access on their next session.

### TS-ADMIN-005: Manage AI Credit Settings

- **Objective:** Validate global credit configuration
- **Preconditions:** Signed in as Admin
- **Steps:**
  1. Navigate to `/dashboard/admin`
  2. Go to Settings/Credits tab
  3. Update credit allocation values
  4. Save
- **Expected Outcome:** Settings persist. New users get updated credit allocations.

### TS-ADMIN-006: View Usage Statistics

- **Objective:** Validate admin analytics
- **Preconditions:** Signed in as Admin
- **Steps:**
  1. Navigate to `/dashboard/admin`
  2. Observe statistics: total users, total notes, AI usage
- **Expected Outcome:** Stats cards show accurate counts. Charts/trends render if present.

---

## Section 19: Activity & Notifications

### TS-ACTIVITY-001: View Activity Page

- **Objective:** Validate full activity history
- **Preconditions:** User has performed various actions
- **Steps:**
  1. Navigate to `/dashboard/activity`
- **Expected Outcome:** Activity events listed in reverse chronological order with action, item type, and timestamp.

### TS-NOTIFY-001: View Notifications

- **Objective:** Validate notification center
- **Preconditions:** User has unread notifications
- **Steps:**
  1. Click the notification bell icon in the sidebar/header
  2. Observe notification list
- **Expected Outcome:** Notifications shown with title, body, and timestamp. Unread count badge visible.

### TS-NOTIFY-002: Mark Notification as Read

- **Objective:** Validate read state toggle
- **Preconditions:** Unread notifications exist
- **Steps:**
  1. Open notification center
  2. Click on a notification
- **Expected Outcome:** Notification marked as read. Unread count decreases.

### TS-NOTIFY-003: Daily Digest Email

- **Objective:** Validate scheduled daily digest delivery
- **Preconditions:** Notification preferences have `daily_digest_enabled = true` and a digest email/time set
- **Steps:**
  1. Wait for the scheduled run of `daily-digest` (or trigger it manually as admin)
  2. Check the configured inbox
- **Expected Outcome:** Digest email arrives summarizing recent notes, pending review items, and stale actions.

---

## Section 20: Content Moderation

### TS-MOD-001: Stopword Filter on Note Save

- **Objective:** Validate the first-tier moderation
- **Preconditions:** A stopword exists in `moderation_stopwords`
- **Steps:**
  1. Create a note containing the stopword
  2. Save the note
- **Expected Outcome:** A `moderation_events` row is recorded with the matched word. Depending on severity, the note is either flagged for review or blocked from saving via `ModerationBlockDialog`.

### TS-MOD-002: AI Moderation Review Queue

- **Objective:** Validate AI-assisted moderation review
- **Preconditions:** A flagged item is queued in `moderation_review_queue`
- **Steps:**
  1. Sign in as Admin
  2. Open the Moderation Panel from the Admin dashboard
  3. Inspect AI category, confidence and reason
  4. Approve or reject the item
- **Expected Outcome:** Item status transitions to `approved` or `rejected`. Strikes/suspensions update on the user via `user_suspensions` if rejected.

### TS-MOD-003: Suspended User Blocked

- **Objective:** Validate suspension enforcement
- **Preconditions:** A test user has `suspended = true`
- **Steps:**
  1. Sign in as that user
  2. Try to create a note
- **Expected Outcome:** Creation is blocked with a moderation/suspension message. User can still read existing data per policy.

---

## Section 21: Public Pages & Navigation

### TS-PUBLIC-001: Landing Page

- **Objective:** Validate public homepage
- **Preconditions:** Not signed in
- **Steps:**
  1. Navigate to `/`
- **Expected Outcome:** Landing page renders with header, hero section, features, and footer. Sign-in/up CTA links work.

### TS-PUBLIC-002: Features Page

- **Objective:** Validate features page
- **Steps:**
  1. Navigate to `/features`
- **Expected Outcome:** Features page renders with feature descriptions.

### TS-PUBLIC-003: Documentation Page

- **Objective:** Validate docs page
- **Steps:**
  1. Navigate to `/docs`
- **Expected Outcome:** Documentation renders with navigation.

### TS-PUBLIC-004: Legal Pages

- **Objective:** Validate all legal pages render
- **Steps:**
  1. Navigate to `/privacy`
  2. Navigate to `/terms`
  3. Navigate to `/cookies`
  4. - **Expected Outcome:** Each page renders legal content in the LegalLayout with proper headings.

### TS-PUBLIC-005: 404 Page

- **Objective:** Validate not-found handling
- **Steps:**
  1. Navigate to `/nonexistent-page`
- **Expected Outcome:** Custom 404 page renders with link back to home.

### TS-PUBLIC-006: Cookie Consent Banner

- **Objective:** Validate cookie consent
- **Preconditions:** First visit (no consent stored)
- **Steps:**
  1. Navigate to `/`
  2. Observe cookie consent banner
  3. Click "Accept" or "Decline"
- **Expected Outcome:** Banner appears on first visit. Dismisses on action. Does not reappear on subsequent visits.

### TS-PUBLIC-007: Theme Toggle (Light/Dark)

- **Objective:** Validate theme switching
- **Steps:**
  1. Find the theme toggle button (sun/moon icon)
  2. Click to switch between light and dark mode
- **Expected Outcome:** Theme switches immediately. Colors, backgrounds, and contrast update. Preference persists on reload.

---

## Section 22: Sidebar Navigation

### TS-NAV-001: Sidebar Navigation Links

- **Objective:** Validate all sidebar navigation items
- **Preconditions:** Signed in
- **Steps:**
  1. Click each sidebar item in order: Dashboard, Notes, People, Groups, Review Queue, Knowledge Graph, Media Library, Weekly Review, Activity, My Profile, Settings
- **Expected Outcome:** Each click navigates to the correct page. Active item is highlighted.

### TS-NAV-002: Profile Completeness Dot in Sidebar

- **Objective:** Validate the colored status dot
- **Preconditions:** Signed in with profile data
- **Steps:**
  1. Observe the dot next to "My Profile" in sidebar
- **Expected Outcome:** 
  - Red dot if profile completeness < 30%
  - Yellow dot if 30-70%
  - Green dot if > 70%

---

## Section 23: Cleanup — Delete Test Data

### TS-CLEANUP-001: Delete All Test Notes

- **Objective:** Remove test notes
- **Steps:**
  1. Navigate to `/dashboard/notes`
  2. Delete all notes created during testing (trash then permanently delete)
- **Expected Outcome:** No test notes remain.

### TS-CLEANUP-002: Delete All Test Contacts

- **Objective:** Remove test contacts
- **Steps:**
  1. Navigate to `/dashboard/people`
  2. Delete all contacts created during testing
- **Expected Outcome:** No test contacts remain.

### TS-CLEANUP-003: Delete All Test Action Items

- **Objective:** Remove test action items
- **Steps:**
  1. Navigate to `/dashboard/actions`
  2. Delete all action items created during testing
- **Expected Outcome:** No test action items remain.

### TS-CLEANUP-004: Delete Test Profile Data

- **Objective:** Remove test profile entries and instructions
- **Steps:**
  1. Navigate to `/dashboard/profile`
  2. Delete all custom entries, custom categories, and agent instructions created during testing
- **Expected Outcome:** Profile reverts to default/empty state.

### TS-CLEANUP-005: Delete Test User Accounts

- **Objective:** Remove test personas
- **Steps:**
  1. Sign in as each test persona
  2. Navigate to Settings → Delete Account
  3. Confirm deletion
  4. Alternatively: delete via Supabase Dashboard → Authentication → Users
- **Expected Outcome:** All three test accounts are deleted. No test data remains.

---

## Expected Test Data Summary

| Entity | Created In | Name / Description | Persona |
|--------|-----------|-------------------|---------|
| User | TS-AUTH-001 | Free test account | Free |
| User | Setup | Premium test account | Premium |
| User | Setup | Admin test account | Admin |
| Note | TS-NOTES-001 | "E2E Test Note" | Free |
| Note | TS-NOTES-002 | "E2E Test Note — Updated" | Free |
| Shared Note | TS-SHARE-001 | Public link for test note | Free |
| Contact | TS-PEOPLE-001 | "Jane Doe" — jane@example.com | Free |
| Action Item | TS-ACTIONS-001 | "Follow up with Jane about the project proposal" | Free |
| Profile Entry | TS-PROFILE-002 | "Full Name" = "Test User" | Free |
| Profile Category | TS-PROFILE-005 | "Hobbies" (custom) | Free |
| Agent Instruction | TS-PROFILE-008 | "Always address me informally" | Free |
| Weekly Review | TS-REVIEW-001 | Generated review for current week | Premium |
