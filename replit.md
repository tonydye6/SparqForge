# SparqForge

## Overview

SparqForge is an AI-powered social media content generation and management tool for Sparq Games. Phases 1–4 are complete.

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
│   │   ├── src/routes/     # API routes including generate.ts, download.ts, calendar-entries.ts
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
- **hashtag_sets** — Reusable hashtag groupings by category (tracks usageCount)
- **campaigns** — Content creation sessions
- **campaign_variants** — Per-platform variants within campaigns
- **calendar_entries** — Scheduled posts (supports drag-reschedule)
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
- `POST /campaigns/:id/variants/:variantId/regenerate` — Single-variant image regeneration with optional refinement instruction
- `PUT /campaigns/:id/variants/:variantId/caption` — Update variant caption
- `PUT /campaigns/:id/variants/:variantId/headline` — Update headline + recomposite
- `GET /campaigns/:id/download` — ZIP export of all variants
- `GET /campaigns/:id/variants/:variantId/download` — Individual variant download
- `GET /campaigns/check-duplicate` — Check for duplicate campaign (templateId + primaryAssetId)
- `POST /campaigns/:id/schedule` — Schedule campaign variants to calendar
- `POST /campaigns/:id/remix` — Remix an existing campaign
- `GET/POST /calendar-entries`, `PUT/DELETE /calendar-entries/:id` — Calendar entry CRUD (PUT supports scheduledAt for drag-reschedule)
- `POST /upload`, `GET /files/:filename`, `GET /files/generated/:filename`

## AI Generation Pipeline

1. **Context Assembly** (`context-assembly.ts`) — Gathers brand DNA, template config, selected assets, hashtag sets, brief text into a structured prompt package. Increments `usageCount` on all hashtag sets used.
2. **Claude Captions** (`claude.ts`) — Generates platform-specific captions + overlay headline text using claude-sonnet-4-6 via Replit AI integrations
3. **Gemini Images** (`imagen.ts`) — Generates images for each platform (1:1, 9:16, 16:9) using gemini-2.5-flash-image via Replit AI integrations
4. **Compositing** (`compositing.ts`) — Overlays gradient + headline text on raw images using Sharp + inline SVG buffers
5. **SSE Streaming** — Real-time progress events: `progress`, `image_progress`, `variant_ready`, `complete`, `error`

Supported platforms: Instagram Feed (1:1), Instagram Story (9:16), Twitter/X (16:9), LinkedIn (16:9), TikTok (9:16)

Brand identities: Crown U (#00A3FF), Rumble U (#FF4D00), Mascot Mayhem (#FFD700), Corporate (#8B5CF6)

## Frontend Pages

- `/` — Campaign Studio (3-panel workspace with AI generation, live variant display, inline caption editing, per-variant refinement, save-as-hashtag-set, download)
- `/assets` — Asset Library (3 tabs: Visual Assets, Briefs & Context, Hashtag Library)
- `/calendar` — Content Calendar (month/week views with drag-to-reschedule in month view)
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
- [x] Gemini image generation (5 platforms: Instagram Feed, Instagram Story, Twitter/X, LinkedIn, TikTok)
- [x] Sharp compositing (gradient overlay + headline text)
- [x] SSE streaming generate endpoint
- [x] Campaign Studio frontend wired to real AI
- [x] ZIP export + individual variant download
- [x] Inline caption editing with API persistence
- [x] Resource scoping (campaign-variant ownership validation)
- [x] SSE disconnect handling
- [x] Cost tracking to cost_logs table

Phase 3 (Review & Collaboration) — Complete:
- [x] Review Queue (Kanban board with drag between status columns)
- [x] Campaign duplicate detection
- [x] Campaign remix flow
- [x] Schedule modal for calendar entry creation

Phase 4 (Review & Calendar) — Complete:
- [x] Content Calendar with month and week views
- [x] Calendar drag-to-reschedule (month view, HTML5 drag-and-drop)
- [x] Per-variant refinement input on variant cards (single image regeneration via Imagen)
- [x] Save as Hashtag Set from caption (extract hashtags, name & save via dialog)
- [x] Hashtag usage count tracking (incremented during context assembly)
- [x] Brand filtering on calendar

Not yet implemented (Phase 5+):
- Authentication (Google OAuth)
- Reference URL pipeline (ScreenshotOne + Gemini Flash analysis)
- Social media publishing
- Template refinement analysis
- Video generation
