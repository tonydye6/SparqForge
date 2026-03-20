# SparqForge

## Overview

SparqForge is an AI-powered social media content generation and management tool for Sparq Games. Phase 1 (Foundation) and Phase 2 (AI Generation Pipeline) are complete.

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
- **AI**: Claude claude-sonnet-4-6 (captions/headlines), Gemini 2.5-flash-image (image generation)
- **Image processing**: Sharp (compositing, overlays)
- **Export**: Archiver (ZIP generation)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   ├── src/routes/     # API routes including generate.ts, download.ts
│   │   ├── src/services/   # AI services (claude.ts, imagen.ts, compositing.ts, context-assembly.ts)
│   │   └── uploads/generated/  # Generated images (raw + composited)
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
- `POST /campaigns/:id/generate` — SSE streaming AI generation pipeline
- `PUT /campaigns/:id/variants/:variantId/caption` — Update variant caption
- `PUT /campaigns/:id/variants/:variantId/headline` — Update headline + recomposite
- `GET /campaigns/:id/download` — ZIP export of all variants
- `GET /campaigns/:id/variants/:variantId/download` — Individual variant download
- `POST /upload`, `GET /files/:filename`, `GET /files/generated/:filename`

## AI Generation Pipeline

1. **Context Assembly** (`context-assembly.ts`) — Gathers brand DNA, template config, selected assets, hashtag sets, brief text into a structured prompt package
2. **Claude Captions** (`claude.ts`) — Generates platform-specific captions + overlay headline text using claude-sonnet-4-6 via Replit AI integrations
3. **Gemini Images** (`imagen.ts`) — Generates images for each platform (1:1, 9:16, 16:9) using gemini-2.5-flash-image via Replit AI integrations
4. **Compositing** (`compositing.ts`) — Overlays gradient + headline text on raw images using Sharp + inline SVG buffers
5. **SSE Streaming** — Real-time progress events: `progress`, `image_progress`, `variant_ready`, `complete`, `error`

Brand identities: Crown U (#00A3FF), Rumble U (#FF4D00), Mascot Mayhem (#FFD700), Corporate (#8B5CF6)

## Frontend Pages

- `/` — Campaign Studio (3-panel workspace with AI generation, live variant display, inline caption editing, download)
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

## Phase Status

Phase 1 (Foundation) — Complete:
- [x] All CRUD persistence, 5 pages, database schema, seeding

Phase 2 (AI Generation Pipeline) — Complete:
- [x] Replit AI integrations provisioned (Anthropic + Gemini)
- [x] Context assembly service
- [x] Claude caption/headline generation
- [x] Gemini image generation (4 platforms in parallel)
- [x] Sharp compositing (gradient overlay + headline text)
- [x] SSE streaming generate endpoint
- [x] Campaign Studio frontend wired to real AI
- [x] ZIP export + individual variant download
- [x] Inline caption editing with API persistence
- [x] Resource scoping (campaign-variant ownership validation)
- [x] SSE disconnect handling
- [x] Cost tracking to cost_logs table

Not yet implemented (Phase 3+):
- Authentication (Google OAuth)
- Reference URL pipeline (ScreenshotOne + Gemini Flash analysis)
- Review/Calendar enhancements
- Social media publishing
- Template refinement analysis
- Video generation
