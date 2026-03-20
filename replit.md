# SparqForge

## Overview

SparqForge is an AI-powered social media content generation and management tool for Sparq Games. Phases 1–7 are complete, Phase 6 (Video + Audio) backend services are in place.

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
- **AI**: Claude claude-sonnet-4-6 (captions/headlines/refinement analysis), Gemini 2.5-flash-image (image generation), Veo 2.0 (video generation)
- **Audio**: ElevenLabs (text-to-music, text-to-SFX)
- **Video processing**: ffmpeg (audio/video merging)
- **Image processing**: Sharp (compositing, overlays)
- **Export**: Archiver (ZIP generation)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   ├── src/routes/     # API routes including generate.ts, download.ts, calendar-entries.ts, social-auth.ts, social-accounts.ts
│   │   ├── src/services/   # AI services (claude.ts, imagen.ts, compositing.ts, context-assembly.ts, token-encryption.ts, token-refresh.ts, publish-*.ts, publish-scheduler.ts, refinement-analysis.ts, video-generation.ts, elevenlabs.ts, audio-merge.ts)
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
- **calendar_entries** — Scheduled posts (supports drag-reschedule, publish status tracking, retry count)
- **social_accounts** — Connected social media accounts (Twitter/X, Instagram, LinkedIn) with encrypted tokens
- **refinement_logs** — User edit tracking for template improvement
- **template_versions** — Template version history with full snapshot for rollback
- **template_recommendations** — Claude-generated improvement recommendations (pending/applied/dismissed)
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
- `POST /campaigns/:id/schedule` — Schedule campaign variants to calendar (supports socialAccounts mapping)
- `POST /campaigns/:id/remix` — Remix an existing campaign
- `GET/POST /calendar-entries`, `PUT/DELETE /calendar-entries/:id` — Calendar entry CRUD (PUT supports scheduledAt for drag-reschedule)
- `POST /calendar-entries/:id/publish` — Manual publish trigger
- `POST /calendar-entries/:id/retry` — Retry failed publish
- `GET /social-accounts` — List connected social accounts (with expiry status enrichment)
- `GET /social-accounts/platform/:platform` — List accounts for specific platform
- `DELETE /social-accounts/:id` — Disconnect a social account
- `POST /social-accounts/:id/refresh` — Refresh expired token
- `GET /templates/:id/versions` — Template version history
- `POST /templates/:id/rollback/:versionId` — Restore template to a previous version
- `GET /templates/:id/stats` — Template performance statistics (approval rate, edit counts)
- `POST /templates/:id/analyze` — Trigger Claude-powered refinement analysis
- `GET /templates/:id/recommendations` — List AI-generated recommendations
- `PUT /templates/:id/recommendations/:recId` — Apply or dismiss a recommendation
- `POST /campaigns/:id/generate-video` — SSE streaming Veo video generation (landscape + portrait)
- `POST /campaigns/:id/variants/:variantId/audio` — Generate ElevenLabs audio + ffmpeg merge
- `POST /campaigns/:id/variants/:variantId/audio-upload` — Upload custom audio + ffmpeg merge
- `POST /upload`, `GET /files/:filename`, `GET /files/generated/:filename`
- `GET /auth/twitter` — Twitter/X OAuth 2.0 PKCE redirect
- `GET /auth/twitter/callback` — Twitter/X OAuth callback
- `GET /auth/instagram` — Instagram (via Facebook) OAuth redirect
- `GET /auth/instagram/callback` — Instagram OAuth callback
- `GET /auth/linkedin` — LinkedIn OAuth 2.0 redirect
- `GET /auth/linkedin/callback` — LinkedIn OAuth callback

## AI Generation Pipeline

1. **Context Assembly** (`context-assembly.ts`) — Gathers brand DNA, template config, selected assets, hashtag sets, brief text into a structured prompt package. Increments `usageCount` on all hashtag sets used.
2. **Claude Captions** (`claude.ts`) — Generates platform-specific captions + overlay headline text using claude-sonnet-4-6 via Replit AI integrations
3. **Gemini Images** (`imagen.ts`) — Generates images for each platform (1:1, 9:16, 16:9) using gemini-2.5-flash-image via Replit AI integrations
4. **Compositing** (`compositing.ts`) — Overlays gradient + headline text on raw images using Sharp + inline SVG buffers
5. **SSE Streaming** — Real-time progress events: `progress`, `image_progress`, `variant_ready`, `complete`, `error`

Supported platforms: Instagram Feed (1:1), Instagram Story (9:16), Twitter/X (16:9), LinkedIn (16:9), TikTok (9:16)

Brand identities: Crown U (#00A3FF), Rumble U (#FF4D00), Mascot Mayhem (#FFD700), Corporate (#8B5CF6)

## Social Account OAuth

- **Twitter/X**: OAuth 2.0 with PKCE flow (uses `X_SparqForge_X_API_Key`)
- **Instagram**: Facebook Login OAuth, exchanges for long-lived token, retrieves IG Business Account (uses `SparqForge_Instagram_App_ID` + `SparqForge_Instagram_App_Secret`)
- **LinkedIn**: OAuth 2.0 with `w_member_social` scope (uses `SparqForge_LinkedIn_Client_ID` + `SparqForge_LinkedIn_Client_Secret`)
- **Token Encryption**: AES-256-GCM encryption at rest (uses `TOKEN_ENCRYPTION_KEY` or `SESSION_SECRET`)
- **Token Refresh**: Automatic check on server startup for tokens expiring within 24 hours
- **TikTok**: Not yet implemented (API keys not available)

## Publishing Engine

- **Publish Scheduler**: Database-backed polling (60s interval) replaces BullMQ. Checks `calendar_entries` where `scheduledAt <= now` and `publishStatus = 'scheduled'`
- **Platform Publishers**: Twitter API v2 (chunked media upload + tweet), Instagram Graph API (container + publish), LinkedIn Marketing API (register upload + UGC post)
- **Retry Logic**: Exponential backoff (2^n minutes, capped at 15min), up to 3 retries
- **Token Decryption**: Access tokens are decrypted at publish time using the same AES-256-GCM scheme from Phase 5A
- **Status Flow**: `scheduled` → `publishing` → `published` (success) or `failed` (with error + retry)

## Frontend Pages

- `/` — Campaign Studio (3-panel workspace with AI generation, live variant display, inline caption editing, per-variant refinement, save-as-hashtag-set, download)
- `/assets` — Asset Library (3 tabs: Visual Assets, Briefs & Context, Hashtag Library)
- `/calendar` — Content Calendar (month/week views with drag-to-reschedule, publish status badges, publish/retry buttons)
- `/review` — Review Queue (Kanban board)
- `/settings` — Settings (2 tabs: Brand Settings, Connected Accounts)

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

Phase 5A (Social Account OAuth + Management UI) — Complete:
- [x] social_accounts table with encrypted token storage
- [x] Twitter/X OAuth 2.0 PKCE flow
- [x] Instagram OAuth via Facebook Login with long-lived token exchange
- [x] LinkedIn OAuth 2.0 flow
- [x] CRUD API for social accounts (list, disconnect, refresh)
- [x] Connected Accounts tab in Settings UI
- [x] Token refresh on server startup for expiring tokens
- [x] AES-256-GCM encryption for access/refresh tokens at rest

Phase 5B (Publishing Engine + Scheduled Publishing) — Complete:
- [x] Platform-specific publishing services (Twitter, Instagram, LinkedIn)
- [x] Database-backed publish scheduler (60s polling interval, replaces BullMQ)
- [x] Retry logic with exponential backoff (up to 3 retries)
- [x] Manual "Publish Now" button on calendar entries (when social account connected)
- [x] "Retry" button for failed entries
- [x] Publish status badges on calendar cards (blue=scheduled, amber=publishing, green=published, red=failed)
- [x] Error messages shown via tooltip on failed entries
- [x] Social account selection dropdown in ScheduleModal
- [x] POST /api/calendar-entries/:id/publish endpoint (manual publish)
- [x] POST /api/calendar-entries/:id/retry endpoint (retry failed)
- [x] Token decryption integration with Phase 5A encryption

Phase 6 (Video + Audio Generation) — Backend Complete:
- [x] Veo 2.0 video generation service (landscape + portrait orientations)
- [x] ElevenLabs audio services (text-to-music, text-to-SFX)
- [x] ffmpeg audio/video merging (replace, mix, mute modes)
- [x] Video generation route with SSE streaming progress
- [x] Audio generation + merge route (ElevenLabs music/SFX/mute)
- [x] Custom audio upload + merge route (MP3/WAV)
- [x] Cost tracking for video + audio generation
- [ ] Video preview UI in Campaign Studio (frontend pending)
- [ ] Audio source selector UI on video variant cards (frontend pending)

Phase 7 (Template Refinement Loop) — Complete:
- [x] Refinement log insertion on caption edits, headline edits, image regenerations, approvals/rejections
- [x] Template versioning with automatic snapshots before updates
- [x] Version history listing + rollback to previous versions
- [x] Claude-powered refinement analysis engine (sends structured patterns to Claude, parses recommendations)
- [x] Template recommendations table (pending/applied/dismissed status)
- [x] Applying recommendations auto-updates template with version snapshot
- [x] Settings UI: expandable TemplateCard with Stats, Recommendations, and Version History panels
- [x] "Run AI Analysis" button triggers Claude analysis from Stats panel
- [x] Side-by-side current vs recommended values with apply/dismiss actions
- [x] OpenAPI spec updated with all Phase 7 + Phase 6 endpoints

Not yet implemented:
- TikTok OAuth (keys not available)
- Authentication (Google OAuth)
- Phase 6 frontend (video preview + audio selector in Campaign Studio)
