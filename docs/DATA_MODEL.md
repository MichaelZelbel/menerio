# Data Model

This document describes the main database entities in plain English. All tables use Row-Level Security (RLS) so users can only access their own data unless explicitly shared.

## Core Entities

### Notes (`notes`)
The central entity. A note has a title, rich-text content, optional tags, and an optional embedding vector for semantic search. Notes can be marked as favourites, pinned, or trashed. They may originate from external apps (`source_app`, `source_id`).

### Note Connections (`note_connections`)
Links between two notes. Each connection has a type (e.g. `wikilink`, `semantic`, `manual`), a strength score, and optional metadata. Used to build the knowledge graph.

### Contacts (`contacts`)
People the user tracks. Includes name, email, phone, company, role, relationship type, and tags. Linked to interactions and action items.

### Contact Interactions (`contact_interactions`)
Records of interactions with a contact (meeting, call, email, etc.). Can reference a source note and include a summary and action items.

### Contact Groups (`contact_groups`)
People workspaces for pipelines, relationship circles, communities, Dream 100 lists, hiring funnels, investor pipelines, and similar missions. Stores name, slug, purpose, description, type, sensitivity, icon, color, template configuration, stages, and archival/trash state.

### Contact Group Memberships (`contact_group_memberships`)
Join table between a person and a group. Stores the member’s pipeline status, priority, position, reason, notes, source notes, template-specific attributes, next-step metadata, and archive state. The same contact can appear in multiple groups with different status and context.

### Group Goals (`group_goals`)
Measurable goals for a group. Supports manual goals as well as goals derived from activity, interactions, or action items.

### Group Briefings (`group_briefings`)
AI-generated summaries of recent group movement, stale members, priorities, and recommended next actions.

### Action Items (`action_items`)
Tasks extracted from notes or created manually. Have a status, priority, optional due date, and can be linked to a contact or source note.

## User & Auth

### Profiles (`profiles`)
Basic user profile: display name, avatar URL, bio, website. One row per authenticated user.

### User Roles (`user_roles`)
Stores roles (`free`, `premium`, `premium_gift`, `admin`) in a separate table to prevent privilege escalation. Checked via `has_role()` security-definer function.

### User Suspensions (`user_suspensions`)
Tracks moderation strikes and suspension status per user.

## AI & Credits

### AI Allowance Periods (`ai_allowance_periods`)
Token budgets granted per time period. Tracks how many tokens were granted and used.

### LLM Usage Events (`llm_usage_events`)
Individual AI usage records: feature, model, token counts, credits charged. Supports idempotency keys to prevent double-charging.

### AI Credit Settings (`ai_credit_settings`)
Global configuration for AI credit system (e.g. default token allowance).

## Knowledge & Media

### Wiki / Lexicon Pages (`wiki_pages`)
Synthesized knowledge pages for concepts, people, groups, sources, overviews, and other durable entities. Stores slug, title, page type, summary, content, source count, and timestamps.

### Wiki / Lexicon Links (`wiki_links`)
Parsed `[[slug]]` links between Lexicon pages. Enables backlinks, missing-link detection, and navigation.

### Wiki / Lexicon Sources (`wiki_page_sources`)
Connects Lexicon pages to the notes that informed them. This keeps synthesized pages auditable and lets users open the original note.

### Wiki / Lexicon Revisions (`wiki_revisions`)
Audit trail for created, updated, manual edit, and rollback events on Lexicon pages. Stores previous content, new content, source note, summary, status, and rollback metadata.

### Media Analysis (`media_analysis`)
Metadata and AI analysis results for attachments (images, PDFs, audio, video). Stores extracted text, descriptions, topics, and embedding vectors.

### Dismissed Suggestions (`dismissed_suggestions`)
Tracks which suggested note connections a user has dismissed, so they are not shown again.

## Profile System

### Profile Categories (`profile_categories`)
User-defined categories for organising profile information (e.g. "Skills", "Preferences"). Categories have a visibility scope.

### Profile Entries (`profile_entries`)
Individual key-value entries within a profile category. Can optionally link to a note.

### Profile Views (`profile_views`)
Named filtered views of profile data based on visibility scopes.

## Integrations

### Connected Apps (`connected_apps`)
External applications connected via the Hub API. Stores API key, webhook URL, permissions, and connection status.

### Hub API Keys (`hub_api_keys`)
API keys for programmatic access to Menerio. Keys are stored as hashes with a visible prefix. Scoped permissions.

### Hub API Usage (`hub_api_usage`)
Rate-limiting counters per API key per time window.

### MCP API Tokens (`mcp_api_tokens`)
Long-lived personal MCP tokens for external AI clients. Raw tokens are shown only once; the database stores token hashes, prefixes, expiration, revocation state, and last-used timestamps.

### GitHub Connections (`github_connections`)
GitHub repository sync configuration: token, repo details, sync direction, branch.

### Telegram Connections (`telegram_connections`)
Telegram bot configuration for note capture via chat.

### Discord Connections (`discord_connections`)
Discord bot configuration for note capture via server channels.

## Moderation

### Moderation Events (`moderation_events`)
Log of all content moderation actions (stopword and AI-based). Records the action taken, category, and tier.

### Moderation Review Queue (`moderation_review_queue`)
Items flagged for manual admin review. Includes AI confidence scores and content snapshots.

### Moderation Stopwords (`moderation_stopwords`)
Word blocklist used for first-pass content filtering. Categorised by type and severity.

## Activity & Notifications

### Activity Events (`activity_events`)
Audit log of user actions (note created, contact updated, etc.).

### Notifications (`notifications`)
In-app notifications with title, body, type, read status, and optional link.

### Notification Preferences (`notification_preferences`)
Per-user settings for digest emails and notification types.

## Other

### Shared Notes (`shared_notes`)
Public sharing tokens for individual notes. One-to-one with notes.

### Sync Log (`sync_log`)
General synchronisation audit trail.

### GitHub Sync Log (`github_sync_log`)
Per-note GitHub sync status and commit references.

### Weekly Reviews (`weekly_reviews`)
Stored weekly review summaries generated by the AI.

### Review Queue (`review_queue`)
AI-generated suggestions awaiting user review. Used for contact creation, profile enrichment, relationships, duplicate handling, group-member suggestions, and other reversible AI actions.

### Agent Instructions (`agent_instructions`)
User-defined instructions that customise AI behaviour per feature area.
