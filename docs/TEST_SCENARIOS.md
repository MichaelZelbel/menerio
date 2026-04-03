# Menerio — End-to-End Test Scenarios

> **Last updated:** 2026-04-03
> **App URL:** https://menerio.lovable.app
> **Preview URL:** https://id-preview--d90589e3-d781-4fdd-bcab-2f98807b83a6.lovable.app

---

## Test Personas

| Persona | Email | Password | Role | Purpose |
|---------|-------|----------|------|---------|
| **Free User** | `test-free@menerio.test` | `TestFree!2026` | `free` | Validates core features and premium gates |
| **Premium User** | `test-premium@menerio.test` | `TestPrem!2026` | `premium` | Validates premium/AI features |
| **Admin User** | `test-admin@menerio.test` | `TestAdmin!2026` | `admin` | Validates admin dashboard and user management |

> **Setup:** Create these users via `/auth` signup, then assign roles via Supabase SQL Editor or the Admin panel.

---

## Section 1: Authentication & Onboarding

### TS-AUTH-001: Sign Up with Email/Password

- **Objective:** Validate new account creation
- **Preconditions:** No account exists for the test email
- **Steps:**
  1. Navigate to `/auth`
  2. Click the "Sign Up" tab
  3. Enter display name "Test Free User"
  4. Enter email `test-free@menerio.test`
  5. Enter password `TestFree!2026` — observe password strength indicator updates
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
- **Preconditions:** An external note exists (synced from Planinio, Querino, or another connected app via `receive-note`)
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
- **Expected Outcome:** A new browser tab opens with the `source_url`, navigating to the note in the originating app (e.g., Planinio, Querino).

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

---

## Section 5: Action Items

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

## Section 6: Knowledge Graph

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

## Section 7: Media Library

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

## Section 8: Weekly Review

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

## Section 9: User Profile System

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

## Section 10: Dashboard

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

## Section 11: AI Features & Credit Tracking

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

## Section 12: Premium Feature Gating

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

## Section 13: Settings & Integrations

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

## Section 14: Admin Dashboard

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

## Section 15: Activity & Notifications

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

---

## Section 16: Public Pages & Navigation

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
  4. Navigate to `/impressum`
- **Expected Outcome:** Each page renders legal content in the LegalLayout with proper headings.

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

## Section 17: Sidebar Navigation

### TS-NAV-001: Sidebar Navigation Links

- **Objective:** Validate all sidebar navigation items
- **Preconditions:** Signed in
- **Steps:**
  1. Click each sidebar item in order: Dashboard, Notes, People, Actions, Knowledge Graph, Media Library, Weekly Review, Activity, My Profile, Settings
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

## Section 18: Cleanup — Delete Test Data

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
| User | TS-AUTH-001 | test-free@menerio.test | Free |
| User | Setup | test-premium@menerio.test | Premium |
| User | Setup | test-admin@menerio.test | Admin |
| Note | TS-NOTES-001 | "E2E Test Note" | Free |
| Note | TS-NOTES-002 | "E2E Test Note — Updated" | Free |
| Shared Note | TS-SHARE-001 | Public link for test note | Free |
| Contact | TS-PEOPLE-001 | "Jane Doe" — jane@example.com | Free |
| Action Item | TS-ACTIONS-001 | "Follow up with Jane about the project proposal" | Free |
| Profile Entry | TS-PROFILE-002 | "Full Name" = "Test User" | Free |
| Profile Category | TS-PROFILE-005 | "Hobbies" (custom) | Free |
| Agent Instruction | TS-PROFILE-008 | "Always address me informally" | Free |
| Weekly Review | TS-REVIEW-001 | Generated review for current week | Premium |
