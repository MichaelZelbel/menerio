

# Plan: Make Menerio Release-Ready Open Source Project

## Overview

Clean up Menerio for a proper open-source release under AGPL-3.0 (same as Querino). Fix all broken links, remove false claims, replace placeholder text, create a proper README and LICENSE file, and ensure the public-facing pages accurately describe what Menerio actually is.

## Issues Found

1. **No LICENSE file** -- needs AGPL-3.0
2. **README.md** is the default Lovable boilerplate
3. **Footer** links to non-existent pages: `/changelog`, `/about`, `/blog`, `/contact`
4. **Footer** social links all point to `#`
5. **Legal pages** (Privacy, Terms, Cookies, Impressum) contain `[Project Name]`, `[projectname]`, `[Your Jurisdiction]`, `[Your Company Address]` placeholders
6. **Impressum** has placeholder company data (address, phone, registration number)
7. **Docs registry** describes Menerio as "project management, team collaboration, and workflow automation" -- false. It's a knowledge/notes system
8. **Docs** reference non-existent features: Projects, Tasks, Analytics, Team Members, 200+ integrations, OAuth 2.0, REST API endpoints (`api.menerio.com`), Enterprise plan
9. **Sidebar** has "Team" link to `/dashboard/team` which doesn't exist
10. **Features page** is a stub with almost no content
11. **package.json** `name` is `vite_react_shadcn_ts`
12. **Copyright footer** says "All rights reserved" -- contradicts AGPL

## Changes

### 1. Create LICENSE file
- Full AGPL-3.0 text with `Copyright (C) 2026 Michael Zelbel` (matching Querino)

### 2. Rewrite README.md
- Follow Querino's structure: description, features list, tech stack, getting started, project structure, "Why AGPL?" section, license section
- Accurately describe Menerio as an AI-powered personal knowledge system with note-taking, semantic search, MCP integration, and cross-app sync

### 3. Fix package.json
- Change `name` to `menerio`

### 4. Clean up Footer
- Remove "Company" column entirely (About, Blog, Contact don't exist)
- Remove "Changelog" from Product links (doesn't exist)
- Keep: Docs (Product), Privacy/Terms/Cookies (Legal)
- Add GitHub link pointing to the actual repo (or remove social links if no URLs yet)
- Change "All rights reserved" to "Licensed under AGPL-3.0"

### 5. Fix legal pages -- replace all placeholders with "Menerio"
- **Privacy.tsx**: Replace `[Project Name]` with "Menerio", `[projectname]` with "menerio", `[Your Company Address]` with "See Impressum"
- **Terms.tsx**: Replace `[Project Name]` with "Menerio", `[Your Jurisdiction]` with "Germany", fix description from "project management" to accurate description
- **Cookies.tsx**: Replace `[Project Name]` with "Menerio"
- **Impressum.tsx**: Replace placeholders with "Menerio" and mark company details as TBD or use Michael Zelbel's name as responsible person

### 6. Rewrite docs registry to match actual features
- Remove fake pages: collaboration, integrations (200+ tools), api-endpoints (projects/tasks CRUD), api-rate-limits (Enterprise plan), team-members
- Rewrite existing pages to describe actual Menerio functionality:
  - Quick Start: notes, AI processing, MCP
  - Dashboard Overview: actual sidebar items (Dashboard, Notes, Settings)
  - AI Insights → AI Processing: embeddings, classification, semantic search
  - Profile Settings: keep as-is (mostly accurate)
  - API Auth → MCP & Edge Functions: describe actual edge functions (receive-note, send-patch, etc.)
- Update FAQ to reflect reality (no project management, no Enterprise plan)

### 7. Remove "Team" from sidebar
- Remove `premiumItems` array with `/dashboard/team` from `DashboardSidebar.tsx`

### 8. Flesh out Features page
- Replace stub with actual feature descriptions matching the homepage (AI embeddings, semantic search, MCP, cross-app sync, rich notes)

### 9. Update robots.txt and sitemap.xml
- Remove `/features` from sitemap if still a stub, or keep if we flesh it out (we will flesh it out)
- Ensure no references to removed pages

## Technical Details

- **Files to create**: `LICENSE`
- **Files to rewrite**: `README.md`, `src/content/docs/registry.tsx`, `src/pages/Features.tsx`
- **Files to edit**: `src/components/layout/Footer.tsx`, `src/components/layout/DashboardSidebar.tsx`, `src/pages/Privacy.tsx`, `src/pages/Terms.tsx`, `src/pages/Cookies.tsx`, `src/pages/Impressum.tsx`, `package.json`
- **No database or edge function changes needed**

