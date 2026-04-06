# SparqMake™ — Replit Agent 4 Initial Build Prompt

## Instructions

Build a web application called **SparqMake™** — an AI-powered social media content generation and management tool for Sparq Games. The complete product specification is in the attached files. Start with **Phase 1: Foundation** as described below.

---

## Attached Documentation (reference these throughout the build)

1. **PRD_SparqMake.md** — Complete product requirements document. This is the source of truth for what the application does.
2. **TECH_SPEC.md** — Full technical specification with database schema, API routes, authentication flow, compositing pipeline, and error handling patterns.
3. **UX_UI_DESIGN.md** — Comprehensive screen layouts, component inventory, interaction specs, design tokens, and responsive behavior.
4. **GENERATION_PIPELINE.md** — The AI generation pipeline: context assembly, prompt templates, compositing step, audio pipeline, parallel execution strategy.
5. **USER_JOURNEYS.md** — Seven detailed user workflows showing how people use every feature end to end.

---

## Tech Stack (use exactly these)

- **Framework:** Next.js 15 with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS (dark-mode-first)
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** NextAuth.js with Google OAuth provider
- **File Storage:** Replit Object Storage (or S3-compatible — use environment variable for endpoint)
- **Image Processing:** Sharp (npm package) for server-side image compositing
- **Video Processing:** ffmpeg for audio/video merging (install if not available)

---

## Phase 1: Foundation — Build This First

### 1.1 Project Scaffolding
- Initialize Next.js 15 project with TypeScript and Tailwind CSS
- **CRITICAL — DARK MODE ONLY:** This application has NO light mode. Every page, component, and element must use dark backgrounds and light text. Do not include a light/dark toggle. Do not use Tailwind's `dark:` prefix variants — instead, set all base styles to dark colors directly. Specifically:
  - Set `<html>` and `<body>` background to `#0A0A0F` in the root layout and in `globals.css`
  - All card/surface backgrounds: `#12121A`
  - All borders: `#1E1E2E`
  - All primary text: `#F0F0F5` (near-white)
  - All secondary text: `#9CA3AF` (muted gray)
  - All inputs/form fields: `#1A1A28` background with `#F0F0F5` text
  - No white backgrounds anywhere in the application
- Set up Prisma with PostgreSQL connection
- Install dependencies: `next-auth`, `prisma`, `@prisma/client`, `sharp`, `zod` (for validation)

### 1.2 Database Schema
Create the Prisma schema with these models (full details in TECH_SPEC.md):

**Brand** — Top-level brand configuration (Crown U, Rumble U, Mascot Mayhem, Corporate)
- Colors (primary, secondary, accent, background)
- Voice description, banned terms, trademark rules
- Imagen prompt prefix and negative prompt
- Hashtag strategy (JSON), platform rules (JSON)
- Logo file URL, brand fonts (JSON)

**Template** — Reusable campaign patterns with AI prompt config AND visual layout specs
- Imagen prompt addition, negative prompt addition
- Claude caption instruction (JSON, per-platform), Claude headline instruction
- Layout Spec (JSON): headline zone position/font/size/color, logo placement, gradient overlay, per-aspect-ratio overrides
- Recommended asset types, target aspect ratios
- Performance metrics, version tracking

**Asset** — Brand asset library items (type: visual or context)
- Status workflow: uploaded → approved → archived
- Tags, file URL, usage count

**Campaign** — Content creation session
- Links to brand, template, selected assets (JSON with roles)
- Reference URL + analysis JSON
- Status: draft | pending_review | approved | scheduled | published | rejected
- Source campaign ID (for Remix tracking)

**CampaignVariant** — Per-platform variant within a campaign
- Platform + aspect ratio
- Raw image URL (Imagen output) + composited image URL (with overlays)
- Video URL, audio source (veo_native | elevenlabs_music | elevenlabs_sfx | uploaded | muted), audio URL
- Caption (editable), original caption (for diff tracking)
- Headline text (composited on image), original headline
- Schedule and publish status

**HashtagSet** — Reusable hashtag groupings by category
- Name, brand association, hashtags array, category, usage count

**RefinementLog** — Captures every user edit for template improvement
- Edit type, platform, original/new values, refinement prompt

**TemplateVersion** — Template version history snapshots

**CalendarEntry** — Scheduled posts with platform target and publish status

**CostLog** — API cost tracking per call

**User** — NextAuth user model with role (admin | editor | viewer)

### 1.3 Authentication
- Configure NextAuth.js with Google OAuth provider
- Three roles: `admin` (Tony, DA — full access), `editor` (Jenn — create/schedule), `viewer` (Chase — review/approve)
- Protect all routes — redirect to login if unauthenticated
- Store user role in database, check on protected actions

### 1.4 Navigation & Layout Shell
Build the application shell with five navigation sections (persistent left sidebar, collapsible):

1. **Campaign Studio** — Primary workspace (default/home)
2. **Asset Library** — Brand assets with three tabs
3. **Calendar** — Content schedule
4. **Review Queue** — Approval pipeline
5. **Settings** — Brand DNA, templates, accounts

- Badge counts on Review Queue (pending items) and Calendar (posts due today)
- Dark mode UI throughout — see design tokens in UX_UI_DESIGN.md
- Sidebar collapses to icons on smaller screens

### 1.5 Brand Settings Screen
Full CRUD for brand configuration:
- Tabbed interface: one tab per brand (Crown U | Rumble U | Mascot Mayhem | Corporate)
- Form sections: Brand DNA (colors with pickers, voice textarea, banned terms, trademark rules), Platform Rules, Templates list, Connected Accounts (placeholder for Phase 5), Font Management (upload fonts for compositing)
- Template editor within settings: edit prompt config + Layout Spec (form-based with JSON preview)
- Save per section with validation

### 1.6 Asset Library Screen
Three-tab interface:
- **Visual Assets tab:** Grid of asset cards with thumbnails, status badges (🟢 Approved, 🟡 Uploaded, 🔴 Archived), drag-and-drop upload, search/filter by game/type/status, click-to-expand detail view, status toggle (uploaded → approved → archived), bulk actions
- **Briefs & Context tab:** List view of text context cards, create/edit with title + rich text body + game/template association
- **Hashtag Library tab:** Grouped list by category (school_specific, campaign, seasonal, trending, evergreen), CRUD for hashtag sets with name/brand/category/hashtags

### 1.7 File Storage Integration
- Configure storage for brand assets, generated images, fonts, logos
- Upload endpoint with file type validation (images: PNG/JPG/WebP, fonts: WOFF2/TTF, audio: MP3/WAV)
- Return storage URL for database reference
- Thumbnail generation for Asset Library grid using Sharp

### 1.8 Campaign Studio Shell (UI only, no AI yet)
Build the three-panel layout structure:
- **Left panel (250px fixed):** Template selector dropdown, asset picker grid with search/filter, reference URL field (UI only), brief/context selector dropdown, "Write custom brief" expandable textarea
- **Center panel (flex):** 2x2 preview grid with placeholder cards at correct aspect ratios, platform labels and icons, caption text areas (editable), refinement input per card, "Refine All" input above grid
- **Right panel (220px fixed):** Activity feed (placeholder), action buttons (Save Draft, Submit for Review, Schedule, Download All), cost indicator

This shell should be fully styled and interactive (state management, form inputs work) but NOT connected to any AI APIs. That's Phase 2.

---

## What NOT to Build Yet (Phase 2+)

Do NOT implement any AI API calls in Phase 1. The following are deferred:
- Anthropic Claude integration (Phase 2)
- Google Imagen 4 Ultra integration (Phase 2)
- Image compositing pipeline (Phase 2)
- Google Veo 3.1 video generation (Phase 6)
- ElevenLabs audio generation (Phase 6)
- Google Gemini Flash analysis (Phase 3)
- ScreenshotOne integration (Phase 3)
- Review Queue Kanban board (Phase 4)
- Content Calendar with scheduling (Phase 4)
- Social media OAuth publishing (Phase 5)
- Template Refinement analysis engine (Phase 7)

Build the UI shells for Campaign Studio and Calendar, but wire them to mock data for now. The AI integration comes in Phase 2 once the foundation is solid.

---

## Design Direction

- **Dark mode first.** Background: `#0A0A0F`. This is a gaming/esports tool — it should feel native to that world.
- **Reference: Linear's design language.** Clean, minimal, purposeful use of color. Not flashy, not corporate.
- **Accent color:** Electric blue `#3B82F6` for primary actions and active states.
- **Typography:** Inter or system font stack. Clean, no serif.
- **Cards and surfaces:** Subtle borders (`#1E1E2E`), slight elevation on hover, no heavy shadows.
- **Status indicators:** Green for success/approved, amber for pending/in-progress, red for failed/rejected, blue for active/selected.
- **Animations:** Minimal. Fade-in for content loading. No unnecessary motion.

---

## Environment Variables

All API keys are already configured in Replit Account Secrets with the names below. Reference these exact names in code via `process.env.SECRET_NAME`:

**Phase 1 (needed now):**
```
DATABASE_URL=                          # Auto-provisioned — add PostgreSQL to this project
NEXTAUTH_SECRET=                       # Generate: openssl rand -base64 32
NEXTAUTH_URL=                          # This app's URL (https://[app].replit.app)
SparqMake_Google_Client_ID=           # Google OAuth — use as GOOGLE_CLIENT_ID in NextAuth config
SparqMake_Google_Client_Secret=       # Google OAuth — use as GOOGLE_CLIENT_SECRET in NextAuth config
```

**Phase 2+ (already in Account Secrets, use when you reach that phase):**
```
SparqMake_Anthropic_API_Key=          # Claude API for captions + headlines (Phase 2)
SparqMake_Gemeni_API_Key=             # Google AI / Gemini API — covers Imagen, Veo, Flash (Phase 2/3/6)
                                       # NOTE: "Gemeni" is intentionally spelled this way — it's the actual secret name
SparqMake_ScreenshotOne_API_Key=      # ScreenshotOne for URL screenshots (Phase 3)
X_SparqMake_X_API_Key=               # Twitter/X API (Phase 5)
SparqMake_Instagram_App_ID=           # Meta/Instagram App ID (Phase 5)
SparqMake_Instagram_App_Secret=       # Meta/Instagram App Secret (Phase 5)
SparqMake_LinkedIn_Client_ID=         # LinkedIn Client ID (Phase 5)
SparqMake_LinkedIn_Client_Secret=     # LinkedIn Client Secret (Phase 5)
SparqMake_ElevenLabs_API_Key=         # ElevenLabs music/SFX/TTS (Phase 6)
```

---

## Success Criteria for Phase 1

When Phase 1 is complete, I should be able to:
1. Log in with Google OAuth
2. Navigate between all five sections
3. Create and configure a brand (Crown U) with full DNA settings including Layout Spec templates
4. Upload, tag, approve, and archive assets in the library
5. Create and manage hashtag sets in the Hashtag Library
6. Create and manage briefs/context cards
7. Open Campaign Studio and interact with the three-panel layout (selecting templates, assets, typing briefs — no AI generation yet)
8. See the dark-mode UI throughout with consistent design tokens
9. All data persists in PostgreSQL via Prisma
