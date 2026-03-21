# SparqForge

## Overview
SparqForge is an AI-powered social media content generation and management tool designed for Sparq Games. It streamlines content creation, scheduling, and publishing across multiple social media platforms, including Instagram, Twitter/X, and LinkedIn. The tool leverages advanced AI models for generating captions, headlines, images, videos, and audio, along with robust features for content refinement, scheduling, and performance tracking. Its core purpose is to enhance content velocity and brand consistency for Sparq Games' various brands.

## User Preferences
The user wants the agent to focus on high-level features and architectural decisions. Avoid granular implementation details. Consolidate redundant information and eliminate repetition. Prioritize architectural decisions over implementation specifics. The agent should remove all changelogs, update logs, and date-wise entries.

## System Architecture
SparqForge is built as a pnpm monorepo using Node.js 24 and TypeScript 5.9. The frontend is a React + Vite application, and the backend API is built with Express 5. PostgreSQL is used for data persistence with Drizzle ORM, and Zod handles validation. OpenAPI specifications are used for API codegen with Orval.

**UI/UX Decisions:**
The application features a dark mode only UI with a specific color palette:
- App background: `#0A0A0F`
- Surface: `#12121A`
- Input fields: `#1A1A28`
- Borders: `#1E1E2E`
- Primary text: `#F0F0F5`
- Secondary text: `#9CA3AF`
- Accent: `#3B82F6`

The frontend comprises several key pages:
- **Campaign Studio**: A 3-panel workspace for AI generation, video generation, live variant display, inline caption editing, per-variant refinement, audio controls, and download options. Features platform-specific preview frames (IG Feed/Story, Twitter/X, LinkedIn, TikTok), inline AI rewrite toolbar for captions, clickable headline overlay editing with automatic re-compositing, and progressive loading with skeleton shimmers and crossfade animations.
- **Asset Library**: Manages visual assets, briefs, context, and hashtag libraries.
- **Content Calendar**: Month/week views with drag-to-reschedule functionality, publish status badges, and publish/retry buttons.
- **Review Queue**: A Kanban board with per-variant approve/reject (mandatory rejection comments feed refinement_logs). Supports bulk and individual variant review actions.
- **Cost Dashboard**: Displays total spend, daily spend charts, breakdowns by service/operation. Includes configurable daily budget threshold with pre-generation budget check and visual alerts.
- **Settings**: Manages brand settings and connected social accounts.

**Technical Implementations & Feature Specifications:**
- **AI Generation Pipeline**:
    1. **Context Assembly**: Gathers brand DNA, template config, assets, hashtag sets, and brief text into a structured prompt. Accepts role-aware generation packets.
    2. **Packet Assembly**: `buildGenerationPacket` classifies assets by role (subject_reference, style_reference, compositing, context), scores candidates, selects optimal 2-3 reference images, excludes compositing-only assets from Imagen calls, and logs decisions to `generation_packet_logs`.
    3. **Caption Generation**: Uses Claude to generate platform-specific captions and overlay headline text.
    4. **Image Generation**: Uses Gemini to generate images for various platform aspect ratios (1:1, 9:16, 16:9). Supports up to 3 reference images (base64 inlineData) injected alongside the text prompt. Subject references go first, then style references.
    5. **Compositing**: Overlays gradients, headline text, and brand logos onto raw images using Sharp. Auto-fetches the brand's primary logo asset for compositing when the layout spec includes logo_placement.
    6. **SSE Streaming**: Provides real-time progress updates during generation.
- **Video and Audio Generation**: Integrates Veo for video generation and ElevenLabs for text-to-music and SFX. ffmpeg handles audio/video merging.
- **Social Account OAuth**: Supports Twitter/X (OAuth 2.0 PKCE), Instagram (via Facebook Login), and LinkedIn (OAuth 2.0). Tokens are encrypted using AES-256-GCM and automatically refreshed.
- **Publishing Engine**: A database-backed scheduler polls for scheduled posts, and platform-specific services handle publishing to Twitter, Instagram, and LinkedIn. Includes retry logic with exponential backoff.
- **Template Refinement Loop**: Tracks user edits (refinement logs), maintains template version history with rollback capabilities, and uses Claude for AI-powered refinement analysis and recommendations.

**Authentication:**
Google OAuth sign-in via Passport.js with cookie-based sessions stored in PostgreSQL (connect-pg-simple). In development, `DEV_AUTH_BYPASS=true` auto-authenticates as a dev user without requiring login. API routes are protected by `requireAuth` middleware (returns 401 for unauthenticated requests in production). Auth routes (`/api/auth/me`, `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/logout`) are mounted before the auth middleware. Health endpoint is also public. The frontend redirects unauthenticated users to `/login` in production. The sidebar displays the authenticated user's name and avatar from the session. Campaign creation uses the authenticated user's ID for `createdBy`, and asset creation uses it for `uploadedBy`.

**Database Schema:**
The database includes tables for `brands` (with `brandAssetConfig` JSON field), `templates`, `assets` (with four-class taxonomy: `assetClass` [compositing/subject_reference/style_reference/context], scoring fields, generation flags), `asset_pairings` (tracks which asset combinations produced good results), `generation_packet_logs` (records which assets were sent to each generation call), `hashtag_sets`, `campaigns`, `campaign_variants`, `calendar_entries`, `social_accounts` (with encrypted tokens), `refinement_logs`, `template_versions`, `template_recommendations`, `cost_logs`, `users` (with roles), `session` (auto-created by connect-pg-simple), and `app_settings` (key-value store for configurable thresholds like `dailyCostThreshold`).

## External Dependencies
- **AI Services**:
    - Claude (claude-sonnet-4-6): For captions, headlines, and refinement analysis.
    - Gemini (gemini-2.5-flash-image): For image generation.
    - Veo 2.0: For video generation.
    - ElevenLabs: For text-to-music and text-to-SFX.
- **Image Processing**: Sharp (for compositing and overlays).
- **Video Processing**: ffmpeg (for audio/video merging).
- **Archiving**: Archiver (for ZIP generation of content).
- **Social Media APIs**:
    - Twitter API v2
    - Instagram Graph API
    - LinkedIn Marketing API