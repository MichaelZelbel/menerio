# Project Structure

```
menerio/
├── docs/                    # Developer documentation (you are here)
├── public/                  # Static assets served as-is (favicon, robots.txt, sitemap)
├── src/                     # Frontend application source
│   ├── assets/              # Images and static imports (logo, favicon)
│   ├── components/          # React components organised by domain
│   │   ├── ui/              # shadcn/ui primitives (button, dialog, card, etc.)
│   │   ├── layout/          # Page shells: Header, Footer, DashboardLayout
│   │   ├── notes/           # Note editor, sidebar, wikilinks, embeds
│   │   ├── settings/        # Settings tabs (API keys, integrations, sync)
│   │   ├── admin/           # Admin-only panels (moderation)
│   │   ├── profile/         # Profile editor and completeness tracker
│   │   ├── graph/           # Knowledge graph visualisation
│   │   ├── docs/            # Reusable doc components (Callout, CodeBlock)
│   │   └── ...              # auth, activity, notifications, onboarding, etc.
│   ├── content/docs/        # In-app documentation pages and registry
│   ├── contexts/            # React context providers (AuthContext)
│   ├── hooks/               # Custom hooks (useNotes, useProfile, useAICredits, etc.)
│   ├── integrations/        # Supabase client and auto-generated types
│   ├── lib/                 # Shared utilities (API errors, uploads, content helpers)
│   ├── pages/               # Route-level page components
│   ├── test/                # Test setup and example tests
│   └── utils/               # Pure utility functions
├── supabase/
│   ├── functions/           # Supabase Edge Functions (Deno)
│   │   ├── _shared/         # Shared helpers (auth, rate limiting, credits)
│   │   └── <function-name>/ # One directory per edge function
│   ├── migrations/          # Database migrations (auto-generated, read-only)
│   └── config.toml          # Edge function configuration
├── .env.example             # Environment variable template
├── LICENSE                  # AGPL-3.0
├── OPEN_SOURCE.md           # Open-source philosophy and principles
├── README.md                # Project overview and getting started
├── package.json             # Dependencies and scripts
├── tailwind.config.ts       # Tailwind CSS theme and design tokens
├── vite.config.ts           # Vite build configuration
└── vitest.config.ts         # Test runner configuration
```

## Key Conventions

- **One page per route** — each file in `src/pages/` maps to a route in `src/App.tsx`.
- **Domain-grouped components** — components are grouped by feature area, not by type.
- **Edge functions are self-contained** — each function has its own `index.ts`; shared code lives in `_shared/`.
- **Design tokens** — colours and spacing are defined in `src/index.css` and `tailwind.config.ts`, not hard-coded in components.
- **Auto-generated types** — `src/integrations/supabase/types.ts` is generated from the database schema and must not be edited manually.
