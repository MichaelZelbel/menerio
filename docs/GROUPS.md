# Groups in Menerio

Groups help you organize people around a shared mission: a pipeline, a relationship circle, a community segment, a research list, or any other set of people you want to move forward intentionally.

A Group is more than a tag. It has members, stages, goals, notes, interactions, AI suggestions, and an automatically maintained Lexicon page.

## What is a Group?

A Group is a focused workspace for a set of people. Examples include:

- A Dream 100 list for relationship building
- An investor or customer pipeline
- Podcast guests or creator collaborations
- Hiring candidates
- Advisors, mentors, or community members

Each Group has a name, purpose, description, type, pipeline stages, and goals. You can start from a template or create a custom Group.

## What is a Membership?

A Membership is the relationship between one person and one Group.

The same person can belong to multiple Groups, and their status can be different in each one. For example, one person might be an “Active contributor” in a community Group and also “Researching” in a Dream 100 Group.

A Membership can include:

- Pipeline status
- Priority
- Reason for inclusion
- Notes
- Template-specific fields such as fit score, best channel, cadence, or role
- Source notes
- Next steps

## Pipeline, List, About, Goals, and Briefing

The Group detail page is split into focused views:

### Pipeline

The Pipeline view shows members grouped by stage. You can drag members between stages on desktop and open a member sheet to update details.

### List

The List view is a compact table of all members. On smaller screens, Menerio defaults to this view so the Group remains easy to use on mobile.

### Goals

Goals make the mission measurable. A goal can be tracked manually or calculated from activity.

Common goal types:

- Manual goals, such as “Warm relationships” or “Committed investors”
- Interaction-count goals, such as “Meaningful interactions in the last 30 days”
- Action-item-count goals, such as completed next steps linked to the Group

Manual goals can be adjusted with +1, -1, or by setting an exact value.

### About

The About tab contains the Group’s purpose, description, type, sensitivity, icon, and Lexicon link.

### Briefing

The Briefing tab generates an AI summary of recent movement, stale members, priorities, and next actions for the Group.

## AI Integration

Groups connect to Menerio’s AI features in several ways:

- Suggest next step: generate a concrete follow-up for a member based on recent notes and interactions.
- Suggest members from notes: scan recent notes and propose people who may belong in the Group.
- Import members from structured notes: detect Markdown tables or numbered lists, preserve order, match or create people, and store extracted fields such as link, relevance, and first step on the membership.
- Generate briefing: create a concise Group report.
- Lexicon page: every Group can get an automatically maintained Lexicon page with purpose, members, and synthesized insights.
- Review Queue: AI member suggestions appear in the Review Queue so you can add, reject, or snooze them.

AI features use the same credit system as the rest of Menerio.

## Structured Note Imports

Some groups start as a note, such as a “Dream 100” table with rank, name, link, relevance, and first step. For these cases, Menerio uses deterministic import logic instead of relying only on fuzzy AI suggestions.

The importer can:

- Find the most relevant source note by comparing the group name and note content.
- Parse Markdown tables and numbered lists.
- Preserve list order in the membership `position` field.
- Match existing people or create missing contacts.
- Store note-derived fields such as external links, relevance, and first steps in membership attributes.
- Update existing memberships instead of creating duplicates.

The same import logic is exposed internally and through the MCP server so external agents can preview or apply group imports consistently.

## Templates Overview

Templates provide a ready-made structure for common workflows:

- Dream 100 — relationship development for high-value people
- Investor Pipeline — fundraising conversations and commitments
- Creator Collaborations — creator discovery through completed collaboration
- Customer Pipeline — lightweight sales stages
- Podcast Guests — guest outreach and production flow
- Hiring Candidates — recruiting pipeline
- Advisors & Mentors — recurring guidance relationships
- Community Members — engagement and contribution tracking

Templates are only starting points. You can adjust the Group, add custom goals, and edit membership details as your workflow evolves.

## Tag Migration

If your existing People records already use tags, Menerio can suggest converting frequently used tags into Groups. This keeps the lightweight tag workflow useful while giving important groups a richer workspace.

## Group Pulse

The dashboard includes Group Pulse, a quick overview of active Groups. It highlights recent activity, member counts, stale members, and action items due this week so you can see where attention is needed.

## MCP and External Agents

External AI tools connected through Menerio’s MCP server can work with groups using the same server-side logic as the app. This includes previewing and importing group members from notes, listing group context, and using review workflows rather than inventing IDs or bypassing user review.
