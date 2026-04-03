import { Callout, CodeBlock } from "@/components/docs/DocComponents";
import type { DocPage, DocCategory } from "./types";

// ── Getting Started ──

const quickStart: DocPage = {
  slug: "quick-start",
  title: "Quick Start",
  description: "Get up and running with Menerio in five minutes.",
  category: "Getting Started",
  headings: [
    { id: "what-is-menerio", title: "What is Menerio?" },
    { id: "sign-up", title: "Sign Up" },
    { id: "capture-first-thought", title: "Capture Your First Thought" },
    { id: "explore-your-dashboard", title: "Explore Your Dashboard" },
  ],
  searchText: "quick start getting started sign up first note capture thought dashboard overview",
  content: () => (
    <>
      <h2 id="what-is-menerio">What is Menerio?</h2>
      <p>Menerio is your AI-powered personal knowledge system — a single place for every thought, meeting note, decision, and idea. Write naturally, and Menerio's AI automatically tags, connects, and enriches your notes so you never lose context again.</p>
      <Callout type="tip" title="One Brain. Every AI.">Menerio follows the Open Brain philosophy: your knowledge stays yours, portable, and connected across every tool you use.</Callout>

      <h2 id="sign-up">Sign Up</h2>
      <p>Head to <strong>menerio.lovable.app/auth</strong> and create a free account with your email — or sign in instantly with Google or GitHub. No credit card required.</p>

      <h2 id="capture-first-thought">Capture Your First Thought</h2>
      <p>Once signed in, there are two ways to jot something down:</p>
      <ul>
        <li><strong>Quick Capture</strong> — press <code>⌘⇧K</code> (or <code>Ctrl+Shift+K</code>) anywhere in the app. A floating card appears. Type your thought and hit <code>⌘↵</code> to save. The AI processes it in the background.</li>
        <li><strong>Notes page</strong> — click <strong>Notes</strong> in the sidebar, then <strong>"+ New Note"</strong>. You'll get a full rich-text editor with file uploads, wikilinks, and more.</li>
      </ul>
      <Callout type="info">Every note you create is automatically processed by AI — it extracts tags, topics, people, and action items for you.</Callout>

      <h2 id="explore-your-dashboard">Explore Your Dashboard</h2>
      <p>Your Dashboard is the home screen. It shows:</p>
      <ul>
        <li><strong>Today's Connections</strong> — notes the AI recently linked together</li>
        <li><strong>Discovery Feed</strong> — resurfaced older notes you might want to revisit</li>
        <li><strong>Quick stats</strong> — total notes, contacts, actions, and pending follow-ups</li>
      </ul>
      <p>From here, you can jump into any section using the sidebar on the left.</p>
    </>
  ),
};

const noteTaking: DocPage = {
  slug: "note-taking",
  title: "Taking Notes",
  description: "Create, edit, and organise your notes with a powerful rich-text editor.",
  category: "Getting Started",
  headings: [
    { id: "creating-a-note", title: "Creating a Note" },
    { id: "rich-text-editor", title: "Rich Text Editor" },
    { id: "file-attachments", title: "File Attachments" },
    { id: "wikilinks", title: "Wikilinks" },
    { id: "quick-capture", title: "Quick Capture" },
  ],
  searchText: "notes create edit rich text editor toolbar bold italic heading image upload attachment wikilink quick capture",
  content: () => (
    <>
      <h2 id="creating-a-note">Creating a Note</h2>
      <p>Open the <strong>Notes</strong> page from the sidebar and click <strong>"+ New Note"</strong>. Give it a title and start writing. Your changes save automatically.</p>

      <h2 id="rich-text-editor">Rich Text Editor</h2>
      <p>The editor supports all the formatting you'd expect:</p>
      <ul>
        <li><strong>Text formatting</strong> — bold, italic, underline, strikethrough, code</li>
        <li><strong>Structure</strong> — headings (H1–H3), bullet lists, numbered lists, blockquotes</li>
        <li><strong>Embeds</strong> — images, videos, audio files, and PDFs inline</li>
      </ul>
      <Callout type="tip" title="Keyboard shortcuts">Use <code>⌘B</code> for bold, <code>⌘I</code> for italic, <code>⌘⇧7</code> for numbered lists, and more — just like any word processor.</Callout>

      <h2 id="file-attachments">File Attachments</h2>
      <p>Drag and drop images, PDFs, audio, or video files directly into the editor. They're uploaded to secure cloud storage and embedded inline. Menerio's AI automatically analyses media — it extracts text from PDFs, describes images, and transcribes audio.</p>

      <h2 id="wikilinks">Wikilinks</h2>
      <p>Type <code>[[</code> to create a link to another note. An autocomplete menu appears so you can find and link notes instantly. Wikilinks create visible connections in your Knowledge Graph and show up in the Backlinks panel.</p>
      <Callout type="info">Wikilinks are bidirectional — if Note A links to Note B, Note B automatically shows Note A in its backlinks.</Callout>

      <h2 id="quick-capture">Quick Capture</h2>
      <p>Press <code>⌘⇧K</code> from anywhere in the app to open a floating capture card. Type your thought, press <code>⌘↵</code>, and it's saved as a new note with full AI processing. Perfect for fleeting ideas you don't want to lose.</p>
    </>
  ),
};

const searchAndOrganise: DocPage = {
  slug: "search-organise",
  title: "Search & Organise",
  description: "Find any note in seconds with keyword and AI-powered semantic search.",
  category: "Getting Started",
  headings: [
    { id: "keyword-search", title: "Keyword Search" },
    { id: "smart-search", title: "Smart Search (Semantic)" },
    { id: "filters", title: "Filters & Sorting" },
    { id: "favourites-pins", title: "Favourites & Pins" },
    { id: "trash", title: "Trash & Recovery" },
  ],
  searchText: "search find filter sort favourite pin trash delete recover keyword semantic smart AI",
  content: () => (
    <>
      <h2 id="keyword-search">Keyword Search</h2>
      <p>The search bar at the top of the Notes page lets you instantly filter notes by title or content. Results update as you type.</p>

      <h2 id="smart-search">Smart Search (Semantic)</h2>
      <p>Toggle <strong>"Smart Search"</strong> to switch from keyword matching to AI-powered semantic search. Instead of exact words, it finds notes by meaning. For example, searching "meeting outcomes" will surface notes about decisions made in meetings, even if those exact words don't appear.</p>
      <Callout type="tip">Smart Search uses the same vector embeddings that power your Knowledge Graph — every note is automatically vectorised when created or updated.</Callout>

      <h2 id="filters">Filters & Sorting</h2>
      <p>Use the filter and sort controls to narrow results:</p>
      <ul>
        <li><strong>Sort by</strong> — newest, oldest, recently updated, or alphabetical</li>
        <li><strong>Filter by tags</strong> — click a tag to show only matching notes</li>
        <li><strong>External vs. local</strong> — external notes from connected apps show an orange badge</li>
      </ul>

      <h2 id="favourites-pins">Favourites & Pins</h2>
      <p>Star a note to add it to your Favourites for quick access. Pin a note to keep it at the top of your list regardless of sorting. Both are available from the note actions menu.</p>

      <h2 id="trash">Trash & Recovery</h2>
      <p>Deleted notes move to the Trash instead of being removed permanently. You can restore them at any time, or empty the trash to free up space.</p>
    </>
  ),
};

// ── AI Features ──

const aiProcessing: DocPage = {
  slug: "ai-processing",
  title: "AI Processing",
  description: "How Menerio's AI automatically enriches every note you write.",
  category: "AI Features",
  headings: [
    { id: "what-happens", title: "What Happens Automatically" },
    { id: "smart-tags", title: "Smart Tags Panel" },
    { id: "note-chat", title: "Chat with Your Note" },
    { id: "ai-credits", title: "AI Credits" },
  ],
  searchText: "AI processing tags topics people entities action items auto tagging note chat credits tokens",
  content: () => (
    <>
      <h2 id="what-happens">What Happens Automatically</h2>
      <p>Every time you save a note, Menerio's AI runs in the background to:</p>
      <ul>
        <li><strong>Classify</strong> — assigns a type (Observation, Idea, Decision, Task, Meeting, etc.)</li>
        <li><strong>Extract topics</strong> — identifies the main subjects</li>
        <li><strong>Detect people</strong> — recognises names mentioned in the text</li>
        <li><strong>Pull out action items</strong> — finds things you need to do</li>
        <li><strong>Generate a summary</strong> — creates a one-line overview</li>
        <li><strong>Create an embedding</strong> — vectorises the note for Smart Search and connection discovery</li>
      </ul>
      <Callout type="info">All AI processing happens on the server. Your notes are encrypted in transit and processed securely.</Callout>

      <h2 id="smart-tags">Smart Tags Panel</h2>
      <p>Open a note and look for the <strong>Smart Tags</strong> panel in the sidebar. It shows:</p>
      <ul>
        <li>The detected <strong>Type</strong> — which you can change via a dropdown</li>
        <li><strong>Topics</strong> — removable pills you can edit</li>
        <li><strong>People</strong> — names extracted from the note</li>
        <li><strong>Summary</strong> and <strong>Action Items</strong> — read-only AI output</li>
      </ul>
      <p>You're always in control — adjust any tag the AI assigned.</p>

      <h2 id="note-chat">Chat with Your Note</h2>
      <p>Open the <strong>Chat</strong> panel in the note sidebar to ask questions about your note's content. The AI uses your note plus relevant context from your vault to answer. Great for brainstorming, rewriting, or exploring ideas.</p>

      <h2 id="ai-credits">AI Credits</h2>
      <p>AI features consume credits from your monthly allowance. Free accounts receive a generous starter allocation; Premium accounts get significantly more. You can check your remaining credits in <strong>Settings → AI Credits</strong>.</p>
      <Callout type="tip">Credits reset monthly. Note processing, chat, media analysis, and connection discovery all count towards your usage.</Callout>
    </>
  ),
};

const knowledgeGraph: DocPage = {
  slug: "knowledge-graph",
  title: "Knowledge Graph",
  description: "Visualise how your notes connect and discover hidden relationships.",
  category: "AI Features",
  headings: [
    { id: "overview", title: "Overview" },
    { id: "connection-types", title: "Connection Types" },
    { id: "local-graph", title: "Local Graph" },
    { id: "analytics", title: "Graph Analytics" },
    { id: "export-graph", title: "Export" },
  ],
  searchText: "knowledge graph connections network visualise links semantic wikilink clusters bridge orphan analytics export",
  content: () => (
    <>
      <h2 id="overview">Overview</h2>
      <p>The Knowledge Graph is a visual map of every note in your vault and how they relate. Open it from the sidebar under <strong>Knowledge Graph</strong>. Each node is a note; each edge is a connection the AI discovered or you created manually.</p>
      <Callout type="tip">Click any node to navigate to that note. Hover to highlight its direct connections.</Callout>

      <h2 id="connection-types">Connection Types</h2>
      <p>Connections are created in three ways:</p>
      <ul>
        <li><strong>Semantic</strong> — the AI detects similar meaning between two notes</li>
        <li><strong>Metadata</strong> — shared tags, topics, or people</li>
        <li><strong>Manual</strong> — you link notes with <code>[[wikilinks]]</code> or via the suggested links panel</li>
      </ul>

      <h2 id="local-graph">Local Graph</h2>
      <p>When editing a note, open the <strong>Local Graph</strong> panel to see only the connections around that specific note. This is a great way to explore related context without the noise of the full graph.</p>

      <h2 id="analytics">Graph Analytics</h2>
      <p>The analytics panel surfaces insights about your knowledge base:</p>
      <ul>
        <li><strong>Topic clusters</strong> — groups of notes that form natural communities</li>
        <li><strong>Bridge notes</strong> — notes that connect otherwise separate clusters</li>
        <li><strong>Orphan notes</strong> — notes with no connections (you can link them or mark as standalone)</li>
      </ul>

      <h2 id="export-graph">Export</h2>
      <p>Export your graph data in JSON or CSV format for use in other tools or for backup.</p>
    </>
  ),
};

const mediaAnalysis: DocPage = {
  slug: "media-analysis",
  title: "Media & Attachments",
  description: "Upload files and let AI extract insights from images, PDFs, audio, and video.",
  category: "AI Features",
  headings: [
    { id: "supported-formats", title: "Supported Formats" },
    { id: "ai-analysis", title: "AI Analysis" },
    { id: "media-library", title: "Media Library" },
  ],
  searchText: "media images PDF audio video upload attachment analysis OCR transcription describe library",
  content: () => (
    <>
      <h2 id="supported-formats">Supported Formats</h2>
      <p>Drop files directly into the note editor to embed them inline:</p>
      <ul>
        <li><strong>Images</strong> — JPG, PNG, GIF, WebP, SVG</li>
        <li><strong>Documents</strong> — PDF (multi-page supported)</li>
        <li><strong>Audio</strong> — MP3, WAV, OGG, M4A</li>
        <li><strong>Video</strong> — MP4, WebM</li>
      </ul>

      <h2 id="ai-analysis">AI Analysis</h2>
      <p>Once uploaded, the AI automatically analyses each attachment:</p>
      <ul>
        <li><strong>Images</strong> — generates a description and extracts any visible text (OCR)</li>
        <li><strong>PDFs</strong> — extracts text from every page and summarises the document</li>
        <li><strong>Audio/Video</strong> — transcribes spoken content</li>
      </ul>
      <p>Extracted content is searchable via Smart Search — so you can find a note by what's inside an attached PDF or image.</p>
      <Callout type="info">Analysis results appear in the <strong>Media Analysis</strong> panel in the sidebar. You can view descriptions, extracted text, and detected topics.</Callout>

      <h2 id="media-library">Media Library</h2>
      <p>The <strong>Media Library</strong> page (accessible from the sidebar) shows all attachments across your vault in one place, with filters by type, analysis status, and associated note.</p>
    </>
  ),
};

// ── People & Actions ──

const contacts: DocPage = {
  slug: "contacts-crm",
  title: "People & Contacts",
  description: "Keep track of the people in your life with Menerio's built-in CRM.",
  category: "People & Actions",
  headings: [
    { id: "contact-list", title: "Contact List" },
    { id: "auto-detection", title: "Auto-Detection from Notes" },
    { id: "interactions", title: "Interaction Tracking" },
    { id: "follow-ups", title: "Follow-Up Reminders" },
  ],
  searchText: "contacts people CRM relationships interactions follow up reminder auto detect names",
  content: () => (
    <>
      <h2 id="contact-list">Contact List</h2>
      <p>The <strong>People</strong> page is your personal CRM. Add contacts with their name, email, company, role, and relationship type. Tag them for easy filtering.</p>

      <h2 id="auto-detection">Auto-Detection from Notes</h2>
      <p>When the AI processes a note, it detects people mentioned in the text. These are surfaced in the Smart Tags panel so you can quickly link them to existing contacts or create new ones.</p>

      <h2 id="interactions">Interaction Tracking</h2>
      <p>Each contact has an interaction log — a timeline of meetings, messages, and shared notes. Interactions are created automatically when a note is linked to a contact, or you can add them manually.</p>

      <h2 id="follow-ups">Follow-Up Reminders</h2>
      <p>Set a <strong>contact frequency</strong> (e.g., every 14 days) and Menerio will remind you when it's been too long since your last interaction. These reminders appear in your Dashboard and in the Daily Digest email.</p>
      <Callout type="tip">The "Today's Connections" widget on your Dashboard highlights contacts who are due for a follow-up.</Callout>
    </>
  ),
};

const actionItems: DocPage = {
  slug: "action-items",
  title: "Action Items",
  description: "Track tasks and to-dos extracted from your notes.",
  category: "People & Actions",
  headings: [
    { id: "how-actions-work", title: "How Actions Work" },
    { id: "managing-actions", title: "Managing Actions" },
    { id: "linking-contacts", title: "Linking to Contacts" },
  ],
  searchText: "action items tasks to-do extracted AI priority due date complete status contact link",
  content: () => (
    <>
      <h2 id="how-actions-work">How Actions Work</h2>
      <p>When you write something like "I need to send the proposal to Sarah by Friday", the AI extracts it as an action item with a due date and a linked person. You'll find all extracted actions on the <strong>Actions</strong> page.</p>

      <h2 id="managing-actions">Managing Actions</h2>
      <p>Each action has:</p>
      <ul>
        <li><strong>Status</strong> — open, in progress, or completed</li>
        <li><strong>Priority</strong> — low, medium, high, or urgent</li>
        <li><strong>Due date</strong> — set automatically or manually</li>
        <li><strong>Source note</strong> — the note it was extracted from</li>
      </ul>
      <p>Click an action to edit it or jump to the source note for context.</p>

      <h2 id="linking-contacts">Linking to Contacts</h2>
      <p>Actions can be linked to a contact. This makes them show up in that contact's interaction timeline, so you always know what's pending with whom.</p>
    </>
  ),
};

const reviewQueue: DocPage = {
  slug: "review-queue",
  title: "Review Queue",
  description: "A central inbox for AI-generated suggestions from your notes.",
  category: "People & Actions",
  headings: [
    { id: "what-is-the-review-queue", title: "What is the Review Queue?" },
    { id: "suggestion-types", title: "Suggestion Types" },
    { id: "accepting-and-dismissing", title: "Accepting & Dismissing" },
  ],
  searchText: "review queue suggestions AI events temerio cherishly contacts accept dismiss inbox",
  content: () => (
    <>
      <h2 id="what-is-the-review-queue">What is the Review Queue?</h2>
      <p>Every time you save a note, the AI scans it for actionable patterns — events with dates and people, new contacts, and cross-app opportunities. Instead of acting silently, it places <strong>suggestions</strong> into your Review Queue so you stay in control.</p>
      <Callout type="tip" title="No extra credits">Suggestions are generated from metadata the AI already extracted — no additional LLM calls, no extra credits.</Callout>

      <h2 id="suggestion-types">Suggestion Types</h2>
      <ul>
        <li><strong>Add Event to Temerio</strong> — a date and people were detected, and you have Temerio connected. The event dialog opens pre-filled so you just confirm.</li>
        <li><strong>Add Event to Cherishly</strong> — same detection, but for saving a cherished memory in Cherishly.</li>
        <li><strong>Add to People</strong> — a person was mentioned who isn't in your contacts yet. Accepting takes you to the People page with the name pre-filled.</li>
      </ul>
      <p>Only suggestions relevant to your connected apps appear. If you haven't connected Temerio, you won't see Temerio suggestions.</p>

      <h2 id="accepting-and-dismissing">Accepting & Dismissing</h2>
      <p>Each suggestion card has two buttons:</p>
      <ul>
        <li><strong>Accept</strong> — opens the appropriate dialog or navigates to the right page with data pre-filled.</li>
        <li><strong>Dismiss</strong> — hides the suggestion permanently. You can always create the event or contact manually later.</li>
      </ul>
      <p>The pending count badge in the sidebar lets you know at a glance how many suggestions are waiting.</p>
    </>
  ),
};

// ── Integrations ──

const appIntegrations: DocPage = {
  slug: "app-integrations",
  title: "App Integrations",
  description: "Connect external apps like Querino, Clarinio, Planinio, and more.",
  category: "Integrations",
  headings: [
    { id: "how-it-works", title: "How It Works" },
    { id: "connected-apps", title: "Connected Apps" },
    { id: "external-notes", title: "External Notes" },
    { id: "open-in-app", title: "Open in Source App" },
    { id: "duplicate-local", title: "Duplicate to Menerio" },
  ],
  searchText: "integrations apps external Querino Temerio Cherishly Clarinio Planinio sync bridge API connected open duplicate",
  content: () => (
    <>
      <h2 id="how-it-works">How It Works</h2>
      <p>Menerio acts as a central knowledge hub. External apps push their content (ideas, documents, posts) into your Menerio vault as read-only notes. This gives you one searchable place for everything without losing ownership in the original app.</p>
      <Callout type="info">The sync is one-way: from each app into Menerio. Your locally created notes are never sent out unless you explicitly choose to.</Callout>

      <h2 id="connected-apps">Connected Apps</h2>
      <p>Go to <strong>Settings → Integrations</strong> to see which apps are connected. Menerio supports:</p>
      <ul>
        <li><strong>Querino</strong> — research and bookmarks</li>
        <li><strong>Temerio</strong> — time-based entries</li>
        <li><strong>Cherishly</strong> — relationship moments</li>
        <li><strong>Clarinio</strong> — structured feedback</li>
        <li><strong>Planinio</strong> — social media studio (Ideas, Content, Posts)</li>
      </ul>
      <p>Each connection uses a secure bridge key and auto-activates once verified.</p>

      <h2 id="external-notes">External Notes</h2>
      <p>Notes from external apps appear in your note list with an <strong>orange "External" badge</strong>. They're read-only — you can view them, search them, and connect them to other notes, but you can't edit the content directly.</p>

      <h2 id="open-in-app">Open in Source App</h2>
      <p>Each external note has an <strong>"Open in [App Name]"</strong> button in the action bar. Click it to jump straight to the original app and edit the content there. Changes sync back to Menerio automatically.</p>

      <h2 id="duplicate-local">Duplicate to Menerio</h2>
      <p>Want an editable copy? Click <strong>"Duplicate to Menerio"</strong> to create a local, fully editable version of the note. The original external note stays unchanged.</p>
    </>
  ),
};

const messagingIntegrations: DocPage = {
  slug: "messaging-integrations",
  title: "Telegram, Slack & Discord",
  description: "Capture thoughts from your favourite messaging platforms.",
  category: "Integrations",
  headings: [
    { id: "telegram", title: "Telegram" },
    { id: "slack", title: "Slack" },
    { id: "discord", title: "Discord" },
  ],
  searchText: "Telegram Slack Discord messaging bot capture chat integration",
  content: () => (
    <>
      <h2 id="telegram">Telegram</h2>
      <p>Connect a Telegram bot to capture messages directly into Menerio as notes. Set up your bot token in <strong>Settings → Telegram</strong>, pair it with a code, and start forwarding messages.</p>

      <h2 id="slack">Slack</h2>
      <p>Send messages to a Slack channel and have them appear as notes in Menerio. Configure your Slack workspace connection in <strong>Settings → Slack</strong>.</p>

      <h2 id="discord">Discord</h2>
      <p>Set up a Discord bot to capture messages from a specific channel. Configure it in <strong>Settings → Discord</strong> with your bot token and guild ID.</p>
      <Callout type="tip">All captured messages go through AI processing — so they get tagged, connected, and searchable just like any other note.</Callout>
    </>
  ),
};

const githubSync: DocPage = {
  slug: "github-sync",
  title: "GitHub Vault Sync",
  description: "Sync your notes with a GitHub repository as Markdown files.",
  category: "Integrations",
  headings: [
    { id: "setup", title: "Setup" },
    { id: "how-sync-works", title: "How Sync Works" },
    { id: "import-vault", title: "Import an Existing Vault" },
    { id: "conflict-resolution", title: "Conflict Resolution" },
  ],
  searchText: "GitHub sync vault Markdown backup export import Obsidian repository git",
  content: () => (
    <>
      <h2 id="setup">Setup</h2>
      <p>Go to <strong>Settings → GitHub Sync</strong> and enter your GitHub personal access token, repository owner, and repo name. Choose a branch and vault path.</p>

      <h2 id="how-sync-works">How Sync Works</h2>
      <p>When enabled, Menerio exports your notes as Markdown files to your GitHub repository. You can configure the sync direction (push only, pull only, or both) and it runs automatically or on-demand.</p>
      <Callout type="info">This is perfect for keeping a Markdown backup or for interoperability with tools like Obsidian.</Callout>

      <h2 id="import-vault">Import an Existing Vault</h2>
      <p>Have an existing Obsidian vault or Markdown collection on GitHub? Use <strong>"Import Vault"</strong> to pull all files into Menerio as notes. Wikilinks and frontmatter are preserved.</p>

      <h2 id="conflict-resolution">Conflict Resolution</h2>
      <p>If a note has been changed in both Menerio and GitHub, the Sync Conflicts panel shows you both versions so you can choose which to keep.</p>
    </>
  ),
};

// ── Your Profile ──

const profilePage: DocPage = {
  slug: "profile",
  title: "Your Profile",
  description: "Build a structured personal profile that the AI uses to personalise your experience.",
  category: "Your Profile",
  headings: [
    { id: "what-is-profile", title: "What It Is" },
    { id: "categories", title: "Categories & Entries" },
    { id: "scopes", title: "Visibility Scopes" },
    { id: "completeness", title: "Profile Completeness" },
    { id: "agent-instructions", title: "Agent Instructions" },
  ],
  searchText: "profile personal information categories entries scope visibility completeness agent instructions AI personalise",
  content: () => (
    <>
      <h2 id="what-is-profile">What It Is</h2>
      <p>Your Profile is more than a settings page — it's a structured overview of who you are, what you care about, and what context the AI should use when processing your notes. Think of it as your brain's "about me" page.</p>

      <h2 id="categories">Categories & Entries</h2>
      <p>Your profile is organised into categories (e.g., "Work", "Health", "Interests") each containing key-value entries. You can add custom categories and entries, and optionally link any entry to a note for deeper context.</p>

      <h2 id="scopes">Visibility Scopes</h2>
      <p>Each category has a visibility scope:</p>
      <ul>
        <li><strong>Private</strong> — only visible to you</li>
        <li><strong>AI</strong> — shared with the AI for better personalisation</li>
        <li><strong>Connected Apps</strong> — shared with apps you've connected</li>
      </ul>

      <h2 id="completeness">Profile Completeness</h2>
      <p>A progress indicator shows how complete your profile is. A richer profile means better AI suggestions, more relevant connections, and smarter processing.</p>

      <h2 id="agent-instructions">Agent Instructions</h2>
      <p>In the <strong>Agent Instructions</strong> tab, write custom instructions for the AI. For example: "Always summarise meeting notes with bullet points" or "Focus on action items related to my startup". The AI follows these when processing your notes.</p>
      <Callout type="tip">Agent Instructions are a powerful way to make Menerio truly yours — experiment with different instructions to shape how the AI works for you.</Callout>
    </>
  ),
};

// ── Workflows ──

const dailyWorkflow: DocPage = {
  slug: "daily-workflow",
  title: "Daily Workflow",
  description: "A typical day using Menerio for personal knowledge management.",
  category: "Workflows",
  headings: [
    { id: "morning", title: "Morning: Review & Plan" },
    { id: "throughout-day", title: "Throughout the Day: Capture" },
    { id: "evening", title: "Evening: Reflect" },
  ],
  searchText: "workflow daily morning evening capture review plan routine habit",
  content: () => (
    <>
      <h2 id="morning">Morning: Review & Plan</h2>
      <p>Start your day on the <strong>Dashboard</strong>. Check your:</p>
      <ul>
        <li><strong>Daily Digest</strong> — a summary email of yesterday's activity (if enabled)</li>
        <li><strong>Action Items</strong> — outstanding tasks from yesterday</li>
        <li><strong>Follow-up reminders</strong> — contacts you should reach out to</li>
        <li><strong>Discovery Feed</strong> — old notes the AI resurfaced that might be relevant today</li>
      </ul>

      <h2 id="throughout-day">Throughout the Day: Capture</h2>
      <p>As thoughts come to you, capture them fast:</p>
      <ul>
        <li><strong>Quick Capture (⌘⇧K)</strong> — one-sentence thoughts, fleeting ideas</li>
        <li><strong>Full notes</strong> — meeting notes, research, decisions</li>
        <li><strong>Messaging bots</strong> — forward Telegram/Slack messages to your vault</li>
      </ul>
      <p>Don't worry about organising — the AI tags and connects everything for you.</p>

      <h2 id="evening">Evening: Reflect</h2>
      <p>Browse your Knowledge Graph to see how today's notes connect to older ones. Use the <strong>Weekly Review</strong> (available every Sunday) for a deeper retrospective on patterns, themes, and progress.</p>
    </>
  ),
};

const weeklyReview: DocPage = {
  slug: "weekly-review",
  title: "Weekly Review",
  description: "Use the AI-generated weekly review to spot patterns and track progress.",
  category: "Workflows",
  headings: [
    { id: "what-it-includes", title: "What It Includes" },
    { id: "how-to-access", title: "How to Access" },
    { id: "making-the-most", title: "Making the Most of It" },
  ],
  searchText: "weekly review summary patterns themes progress retrospective reflect",
  content: () => (
    <>
      <h2 id="what-it-includes">What It Includes</h2>
      <p>Every week, Menerio generates a review of your activity:</p>
      <ul>
        <li><strong>Notes created</strong> — a count and summary of what you wrote</li>
        <li><strong>Themes & patterns</strong> — recurring topics the AI noticed</li>
        <li><strong>Connections made</strong> — new links between notes</li>
        <li><strong>Open actions</strong> — tasks still pending</li>
      </ul>

      <h2 id="how-to-access">How to Access</h2>
      <p>Navigate to the <strong>Weekly Review</strong> page from the sidebar. Past reviews are stored so you can look back over weeks or months.</p>

      <h2 id="making-the-most">Making the Most of It</h2>
      <p>Use the weekly review as a reflection tool. Ask yourself: What surprised me? What patterns am I noticing? Are there action items I keep postponing? This practice turns Menerio from a note-taking app into a genuine thinking partner.</p>
      <Callout type="tip">Pair the weekly review with your Agent Instructions — tell the AI what to focus on in future reviews.</Callout>
    </>
  ),
};

// ── Settings & Account ──

const settingsAccount: DocPage = {
  slug: "settings",
  title: "Settings & Account",
  description: "Manage your account, preferences, API keys, and subscription.",
  category: "Settings",
  headings: [
    { id: "general", title: "General Settings" },
    { id: "notifications", title: "Notifications" },
    { id: "api-keys", title: "API Keys" },
    { id: "subscription", title: "Subscription & Credits" },
    { id: "data-export", title: "Data Export" },
    { id: "delete-account", title: "Delete Account" },
  ],
  searchText: "settings account preferences notifications API keys subscription premium credits export delete",
  content: () => (
    <>
      <h2 id="general">General Settings</h2>
      <p>Update your display name, avatar, bio, and website from <strong>Settings → Profile</strong>. Theme switching (light/dark mode) is available from the toggle in the header.</p>

      <h2 id="notifications">Notifications</h2>
      <p>Configure what notifications you receive:</p>
      <ul>
        <li><strong>Daily Digest</strong> — an email summary of your activity</li>
        <li><strong>Contact follow-ups</strong> — reminders when contacts are overdue</li>
        <li><strong>Stale actions</strong> — alerts for long-open tasks</li>
        <li><strong>Pattern detection</strong> — when the AI spots emerging themes</li>
        <li><strong>Weekly Review</strong> — notification when your review is ready</li>
      </ul>

      <h2 id="api-keys">API Keys</h2>
      <p>Generate API keys in <strong>Settings → API Keys</strong> to access Menerio's Hub API. Each key has configurable scopes (notes, contacts, actions, stats) and can be revoked at any time.</p>
      <CodeBlock code={`curl -H "Authorization: Bearer mb_abc123..." \\\n  https://your-project.supabase.co/functions/v1/hub-api-notes`} language="bash" title="Using the Hub API" />

      <h2 id="subscription">Subscription & Credits</h2>
      <p>View your current plan and AI credit usage in <strong>Settings → Subscription</strong>. Free accounts include a monthly AI credit allowance; upgrade to Premium for more credits and features.</p>

      <h2 id="data-export">Data Export</h2>
      <p>Export all your notes as JSON or Markdown from <strong>Settings → Export</strong>. Your data is always yours.</p>

      <h2 id="delete-account">Delete Account</h2>
      <p>If you need to leave, go to <strong>Settings → Danger Zone</strong> to permanently delete your account and all associated data. This action cannot be undone.</p>
      <Callout type="warning" title="Before deleting">Export your data first. Once deleted, your notes, contacts, and profile cannot be recovered.</Callout>
    </>
  ),
};

// ── FAQ ──

const faq: DocPage = {
  slug: "faq",
  title: "Frequently Asked Questions",
  description: "Answers to common questions about Menerio.",
  category: "FAQ",
  headings: [
    { id: "general", title: "General" },
    { id: "ai-privacy", title: "AI & Privacy" },
    { id: "pricing", title: "Pricing" },
    { id: "technical", title: "Technical" },
  ],
  searchText: "faq questions answers help support pricing free premium privacy data open source self-host export",
  content: () => (
    <>
      <h2 id="general">General</h2>
      <h3>What is Menerio?</h3>
      <p>Menerio is an open-source, AI-powered personal knowledge system. It's a single place for your thoughts, notes, contacts, and actions — with AI that connects everything automatically.</p>
      <h3>Is Menerio open source?</h3>
      <p>Yes. Menerio is licensed under AGPL-3.0. You can inspect the source code, contribute, or self-host.</p>
      <h3>Can I use it on mobile?</h3>
      <p>Menerio is a responsive web app that works in any mobile browser. A native mobile app is on the roadmap.</p>

      <h2 id="ai-privacy">AI & Privacy</h2>
      <h3>Is my data used to train AI models?</h3>
      <p>No. Your notes are processed to generate tags and connections for <em>your</em> account only. They are never used to train foundation models.</p>
      <h3>Where is my data stored?</h3>
      <p>Your data is stored securely in a Supabase-hosted PostgreSQL database with row-level security. Attachments are stored in encrypted cloud storage.</p>

      <h2 id="pricing">Pricing</h2>
      <h3>Is there a free plan?</h3>
      <p>Yes. The free plan includes all core features — notes, AI processing, Knowledge Graph, contacts, and integrations — with a monthly AI credit limit.</p>
      <h3>What does Premium include?</h3>
      <p>Premium unlocks higher AI credit limits, priority processing, and early access to new features. You can upgrade from Settings → Subscription.</p>

      <h2 id="technical">Technical</h2>
      <h3>What browsers are supported?</h3>
      <p>Chrome, Firefox, Safari, and Edge (latest versions). The app works best on Chromium-based browsers.</p>
      <h3>Can I export my data?</h3>
      <p>Yes. Export all notes as JSON or Markdown anytime from Settings → Export. Your data is always yours to take with you.</p>
      <h3>Can I import from Obsidian?</h3>
      <p>Yes. Use the GitHub Vault Sync feature to import a Markdown vault from GitHub, preserving wikilinks and frontmatter.</p>
      <Callout type="info">Have a question not answered here? Reach out via the community or open an issue on GitHub.</Callout>
    </>
  ),
};

// ── Registry ──

export const allDocs: DocPage[] = [
  quickStart,
  noteTaking,
  searchAndOrganise,
  aiProcessing,
  knowledgeGraph,
  mediaAnalysis,
  contacts,
  actionItems,
  reviewQueue,
  appIntegrations,
  messagingIntegrations,
  githubSync,
  profilePage,
  dailyWorkflow,
  weeklyReview,
  settingsAccount,
  faq,
];

export const docCategories: DocCategory[] = [
  {
    name: "Getting Started",
    slug: "getting-started",
    pages: [
      { slug: "quick-start", title: "Quick Start" },
      { slug: "note-taking", title: "Taking Notes" },
      { slug: "search-organise", title: "Search & Organise" },
    ],
  },
  {
    name: "AI Features",
    slug: "ai-features",
    pages: [
      { slug: "ai-processing", title: "AI Processing" },
      { slug: "knowledge-graph", title: "Knowledge Graph" },
      { slug: "media-analysis", title: "Media & Attachments" },
    ],
  },
  {
    name: "People & Actions",
    slug: "people-actions",
    pages: [
      { slug: "contacts-crm", title: "People & Contacts" },
      { slug: "action-items", title: "Action Items" },
      { slug: "review-queue", title: "Review Queue" },
    ],
  },
  {
    name: "Integrations",
    slug: "integrations",
    pages: [
      { slug: "app-integrations", title: "App Integrations" },
      { slug: "messaging-integrations", title: "Telegram, Slack & Discord" },
      { slug: "github-sync", title: "GitHub Vault Sync" },
    ],
  },
  {
    name: "Your Profile",
    slug: "profile",
    pages: [
      { slug: "profile", title: "Your Profile" },
    ],
  },
  {
    name: "Workflows",
    slug: "workflows",
    pages: [
      { slug: "daily-workflow", title: "Daily Workflow" },
      { slug: "weekly-review", title: "Weekly Review" },
    ],
  },
  {
    name: "Settings",
    slug: "settings",
    pages: [
      { slug: "settings", title: "Settings & Account" },
    ],
  },
  {
    name: "FAQ",
    slug: "faq",
    pages: [{ slug: "faq", title: "FAQ" }],
  },
];

export function getDoc(slug: string): DocPage | undefined {
  return allDocs.find((d) => d.slug === slug);
}

export function getAdjacentDocs(slug: string): { prev?: { slug: string; title: string }; next?: { slug: string; title: string } } {
  const flat = docCategories.flatMap((c) => c.pages);
  const idx = flat.findIndex((p) => p.slug === slug);
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  };
}
