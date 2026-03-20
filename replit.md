# SparqForge

## Overview

SparqForge is an AI-powered social media content generation and management tool for Sparq Games. Currently in Phase 1 (Foundation) — UI and data persistence are complete, no AI API calls yet.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/sparqforge)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   ├── sparqforge/         # React + Vite frontend (SparqForge UI)
│   └── mockup-sandbox/     # Component preview server
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── attached_assets/        # PRD, tech spec, UX/UI spec, generation pipeline docs
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Database Schema

Tables (Drizzle ORM in lib/db/src/schema/):
- **brands** — Brand configuration (Crown U, Rumble U, Mascot Mayhem, Corporate)
- **templates** — Campaign templates with AI prompt config + layout specs
- **assets** — Brand asset library (visual + context types)
- **hashtag_sets** — Reusable hashtag groupings by category
- **campaigns** — Content creation sessions
- **campaign_variants** — Per-platform variants within campaigns
- **calendar_entries** — Scheduled posts
- **refinement_logs** — User edit tracking for template improvement
- **cost_logs** — API cost tracking
- **users** — User accounts with roles (admin, editor, viewer)

## API Endpoints

All at `/api`:
- `GET/POST /brands`, `GET/PUT/DELETE /brands/:id`
- `GET/POST /templates`, `GET/PUT/DELETE /templates/:id`
- `GET/POST /assets`, `GET/PUT/DELETE /assets/:id`
- `GET/POST /hashtag-sets`, `PUT/DELETE /hashtag-sets/:id`
- `GET/POST /campaigns`, `GET/PUT /campaigns/:id`
- `POST /upload`, `GET /files/:filename`

## Frontend Pages

- `/` — Campaign Studio (3-panel workspace)
- `/assets` — Asset Library (3 tabs: Visual Assets, Briefs & Context, Hashtag Library)
- `/calendar` — Content Calendar
- `/review` — Review Queue (Kanban board)
- `/settings` — Brand Settings (tabbed per brand)

## Design Tokens

Dark mode only (no light mode):
- App background: #0A0A0F
- Surface: #12121A
- Input fields: #1A1A28
- Borders: #1E1E2E
- Primary text: #F0F0F5
- Secondary text: #9CA3AF
- Accent: #3B82F6

## Phase 1 Status

Complete:
- [x] Project scaffolding with dark mode
- [x] Database schema (all models)
- [x] API routes for all CRUD operations
- [x] Navigation & layout shell (sidebar with 5 sections)
- [x] Campaign Studio 3-panel UI (mock data, no AI)
- [x] Asset Library with 3 tabs
- [x] Brand Settings with tabbed interface
- [x] Calendar view
- [x] Review Queue Kanban
- [x] File upload endpoint

Not yet implemented (Phase 2+):
- Authentication (Google OAuth via NextAuth)
- AI integrations (Claude, Imagen, Veo, Gemini Flash)
- Image compositing pipeline
- Video generation
- Social media publishing
- Template refinement analysis
