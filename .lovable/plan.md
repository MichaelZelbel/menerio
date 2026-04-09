

## Problem

The homepage speaks to developers who already know what "MCP", "semantic search", and "AI embeddings" mean. A regular visitor sees buzzwords and has no idea what to actually **do** with Menerio or why they'd want it.

## Approach: Rewrite the Homepage for Clarity

Restructure `src/pages/Index.tsx` with a story-driven flow that answers three questions every visitor has: **What is this? Why should I care? What do I do?**

### New Section Structure

**1. Hero — Problem + Solution (replaces current abstract hero)**
- Headline: "Remember everything. Find anything."
- Subheading: Plain-language explanation — "Menerio is your personal knowledge base. Write down thoughts, ideas, meeting notes, or links — and AI makes them searchable by meaning, not just keywords."
- Two CTAs: "Get Started Free" + "See How It Works" (scrolls to section 3)
- Trust badges stay (Free, Open Source) but drop "MCP-ready" — nobody visiting cold knows what that means

**2. Use Cases — "What people use Menerio for" (NEW section)**
- 4 concrete scenarios with relatable icons:
  - "Save ideas before you forget them" — quick capture from anywhere
  - "Find that thing you read last month" — semantic search finds by meaning
  - "Connect the dots between your notes" — AI surfaces related thoughts automatically
  - "Use your notes in any AI tool" — feed your knowledge into ChatGPT, Claude, Cursor
- Each use case is a short card with a one-sentence description

**3. How It Works — Visual 3-step walkthrough (improved)**
- Step 1: "Write or paste anything" — notes, links, voice memos, Slack messages
- Step 2: "AI organizes it for you" — auto-tags, embeds, finds connections
- Step 3: "Search and use anywhere" — find by meaning, plug into AI tools
- Keep the numbered visual treatment

**4. Features Grid (keep, but simplify language)**
- Rename "AI-Powered Memory" → "Never forget anything"
- Rename "Semantic Search" → "Search by meaning"
- Rename "MCP-Ready" → "Works with any AI tool"
- Keep icons, make descriptions shorter and benefit-focused

**5. Final CTA (keep, minor copy update)**
- "Start capturing your thoughts" instead of "Ready to build your brain?"

### Visual Improvements
- Add a subtle animated illustration/mockup area in the hero showing a note being captured and then found via search (using styled Card components, no external images needed)
- Slightly warmer, more inviting tone throughout

### Files Modified
- `src/pages/Index.tsx` — full rewrite of content and section structure

### What stays the same
- All animation variants (fadeUp, stagger)
- Auth redirect logic
- SEO head
- Overall tech stack (motion, Card, Badge, Button)

