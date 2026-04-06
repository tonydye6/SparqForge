# SparqMake™ — Comprehensive Codebase Gap Analysis

**Date:** March 20, 2026
**Scope:** Full audit of https://github.com/tonydye6/SparqMake
**Purpose:** Identify every issue preventing features from working flawlessly. This document serves as the development plan input for Replit Agent.
**Exclusions:** TikTok and YouTube integration gaps are excluded (tracked separately in `TIKTOK_PHASE5_PROMPT.md`).

---

## How to Use This Document

Each issue is categorized by severity and area. Replit Agent should:
1. Fix all **CRITICAL** issues first (app-breaking bugs)
2. Then fix **HIGH** issues (features that will fail in production)
3. Then fix **MEDIUM** issues (correctness and reliability)
4. Then fix **LOW** issues (code quality and hardening)

Each issue includes the exact file path, line context, what's wrong, and how to fix it.

---

## CRITICAL — App Will Not Function

### C1. Google OAuth Environment Variable Mismatch (LOGIN BROKEN)

**Files:**
- `artifacts/api-server/src/middleware/auth.ts`
- `artifacts/api-server/src/lib/passport.ts`

**Problem:** The code checks for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, but the actual Replit Secrets are named `SparqMake_Google_Client_ID` and `SparqMake_Google_Client_Secret`. Google OAuth login will fail in production because the env vars will be `undefined`.

**Fix:** In `passport.ts`, change:
```typescript
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
```
to:
```typescript
const GOOGLE_CLIENT_ID = process.env.SparqMake_Google_Client_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.SparqMake_Google_Client_Secret || process.env.GOOGLE_CLIENT_SECRET;
```

In `auth.ts`, update `isGoogleConfigured()` to check both naming conventions:
```typescript
export function isGoogleConfigured(): boolean {
  return !!(
    (process.env.SparqMake_Google_Client_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.SparqMake_Google_Client_Secret || process.env.GOOGLE_CLIENT_SECRET)
  );
}
```

Also check `GOOGLE_CALLBACK_URL` in `passport.ts` — ensure it defaults to the Replit app URL, not just `/api/auth/google/callback` (which is relative and may not resolve correctly behind a proxy).

---

### C2. Twitter/X Media Upload Uses Wrong Auth Method (PUBLISH BROKEN)

**File:** `artifacts/api-server/src/services/publish-twitter.ts`

**Problem:** The Twitter v1.1 media upload endpoint (`https://upload.twitter.com/1.1/media/upload.json`) requires OAuth 1.0a authentication, but the code sends a Bearer token:
```typescript
headers: {
  Authorization: `Bearer ${accessToken}`,  // WRONG
```
Bearer tokens (OAuth 2.0) work for Twitter API v2 tweet creation, but the v1.1 media upload endpoint requires OAuth 1.0a signed requests.

**Fix:** Either:
- **Option A (Recommended):** Switch to Twitter API v2 media upload if available in the app's access tier
- **Option B:** Implement OAuth 1.0a request signing using a library like `oauth-1.0a` for the media upload portion only. This requires storing the OAuth 1.0a consumer key/secret and the user's access token/secret (different from the OAuth 2.0 bearer token).
- **Option C (Simplest):** For image tweets, use the v2 tweet endpoint with media URL directly if the app tier supports it. Check Twitter API v2 media upload documentation for current capabilities.

**Note:** Text-only tweets will work fine with the current Bearer token approach. Only media uploads are broken.

---

### C3. LinkedIn Author URN Format Mismatch (PUBLISH BROKEN)

**File:** `artifacts/api-server/src/services/publish-linkedin.ts`

**Problem:** The `socialAccount.accountId` stores the OpenID Connect `sub` claim (a raw ID string), but the LinkedIn UGC Posts API requires the author field in `urn:li:person:{id}` format:
```typescript
result = await publishToLinkedIn({
  accessToken: decryptedAccessToken,
  authorUrn: socialAccount.accountId,  // stores "sub" not "urn:li:person:xxx"
```

**Fix:** When storing the LinkedIn account during OAuth callback in `social-auth.ts`, prepend the URN prefix:
```typescript
accountId: `urn:li:person:${profileData.sub}`,
```
Or, fix it at publish time:
```typescript
authorUrn: socialAccount.accountId.startsWith("urn:li:person:")
  ? socialAccount.accountId
  : `urn:li:person:${socialAccount.accountId}`,
```

---

### C4. LinkedIn Uses Deprecated v2 UGC API (WILL STOP WORKING)

**File:** `artifacts/api-server/src/services/publish-linkedin.ts`

**Problem:** The code uses the legacy `ugcPosts` endpoint and `registerUpload` flow, which LinkedIn has deprecated in favor of the Community Management API (v2 Posts API). LinkedIn may disable these endpoints at any time.

**Fix:** Migrate to LinkedIn's Community Management API:
- Replace `https://api.linkedin.com/v2/assets?action=registerUpload` with the new image upload flow
- Replace `https://api.linkedin.com/v2/ugcPosts` with `https://api.linkedin.com/rest/posts`
- Update request body format to match the new API schema
- Add `LinkedIn-Version: 202401` header (or current version) as required by the new API

---

### C5. No Foreign Key Constraints in Database (DATA INTEGRITY AT RISK)

**Files:** All schema files in `lib/db/src/schema/`

**Problem:** No foreign key constraints exist anywhere in the schema. This means:
- Campaigns can reference non-existent brands
- Variants can reference non-existent campaigns
- Calendar entries can reference non-existent variants
- Deleting a brand leaves orphaned campaigns, assets, templates, etc.

**Fix:** Add foreign key references to all relationship columns:
```typescript
// Example for campaigns.ts
brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
templateId: text("template_id").references(() => templatesTable.id, { onDelete: "set null" }),

// Example for campaignVariantsTable
campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),

// Example for calendarEntriesTable
campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
variantId: text("variant_id").notNull().references(() => campaignVariantsTable.id, { onDelete: "cascade" }),
socialAccountId: text("social_account_id").references(() => socialAccountsTable.id, { onDelete: "set null" }),

// Example for refinementLogsTable
campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
variantId: text("variant_id").notNull().references(() => campaignVariantsTable.id, { onDelete: "cascade" }),

// Example for costLogsTable
campaignId: text("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),

// Example for hashtagSetsTable
brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),

// Example for templateVersionsTable
templateId: text("template_id").notNull().references(() => templatesTable.id, { onDelete: "cascade" }),

// Example for templateRecommendationsTable
templateId: text("template_id").notNull().references(() => templatesTable.id, { onDelete: "cascade" }),
```

After adding FKs, generate and run a Drizzle migration.

---

### C6. Variant Deletion Without Transaction (DATA LOSS RISK)

**File:** `artifacts/api-server/src/routes/generate.ts`

**Problem:** When regenerating a campaign, existing variants are deleted before new ones are inserted, but this is NOT wrapped in a database transaction. If insertion fails after deletion, all variant data is permanently lost:
```typescript
// Deletes all variants
await db.delete(campaignVariantsTable).where(eq(campaignVariantsTable.campaignId, campaignId));
// Then inserts new ones — if THIS fails, old variants are gone forever
```

**Fix:** Wrap the delete + insert in a Drizzle transaction:
```typescript
await db.transaction(async (tx) => {
  await tx.delete(campaignVariantsTable).where(eq(campaignVariantsTable.campaignId, campaignId));
  for (const variant of newVariants) {
    await tx.insert(campaignVariantsTable).values(variant);
  }
  await tx.update(campaignsTable).set({ status: "generated" }).where(eq(campaignsTable.id, campaignId));
});
```

---

## HIGH — Features Will Fail in Production

### H1. Budget Check Race Condition

**File:** `artifacts/api-server/src/routes/generate.ts`

**Problem:** The daily budget check reads the current spend, compares against threshold, and then proceeds with generation — but doesn't reserve the budget. Two concurrent generation requests can both pass the check and exceed the daily budget.

**Fix:** Use a database-level advisory lock or a simple row-level lock during budget check + spend logging:
```typescript
await db.transaction(async (tx) => {
  // Lock the settings row or use SELECT ... FOR UPDATE on cost_logs
  const todaySpend = await calculateTodaySpend(tx);
  if (todaySpend + estimatedCost > dailyBudget) {
    throw new Error("Daily budget exceeded");
  }
  // Reserve the budget by inserting estimated cost log immediately
  await tx.insert(costLogsTable).values({ ... estimatedCost ... });
});
// Then proceed with generation
```

---

### H2. Instagram Story Uses Feed Publishing Flow (STORIES BROKEN)

**File:** `artifacts/api-server/src/services/publish-instagram.ts`

**Problem:** Instagram Stories require a different API flow than Feed posts. The current code uses the container-based Feed publishing flow for all Instagram content, but Stories need `media_type: "STORIES"` and a different container creation endpoint.

**Fix:** Check the variant platform and branch the logic:
```typescript
if (platform === "instagram_story") {
  // Use Stories-specific container creation
  // POST /{ig-user-id}/media with media_type=STORIES
} else {
  // Existing Feed container flow
}
```

---

### H3. Instagram Requires Publicly Accessible Image URLs

**File:** `artifacts/api-server/src/services/publish-instagram.ts`

**Problem:** The Instagram Graph API requires `image_url` to be a publicly accessible URL. If the Replit app serves images from `/api/files/generated/...`, this URL must be the full public URL (e.g., `https://sparqmake.replit.app/api/files/generated/...`), not a relative path.

**Fix:** When calling `publishToInstagram`, construct the full public URL:
```typescript
const publicImageUrl = `${process.env.APP_URL || "https://sparqmake.replit.app"}/api/files/generated/${filename}`;
```
Also ensure the file serving route does NOT require authentication for generated images (since Instagram's servers need to fetch them).

---

### H4. CORS Configuration Too Permissive

**File:** `artifacts/api-server/src/app.ts`

**Problem:** CORS is configured as `origin: true` with `credentials: true`, allowing any website to make authenticated requests to the API.

**Fix:**
```typescript
app.use(cors({
  origin: process.env.CORS_ORIGIN || "https://sparqmake.replit.app",
  credentials: true,
}));
```
In development, this can be set to `http://localhost:5173` (Vite dev server).

---

### H5. No CSRF Protection

**File:** `artifacts/api-server/src/app.ts`

**Problem:** No CSRF protection middleware exists. Combined with the permissive CORS, this makes the app vulnerable to cross-site request forgery attacks.

**Fix:** Add `csurf` or a custom CSRF token middleware. At minimum, validate the `Origin` or `Referer` header on state-changing requests (POST/PUT/DELETE).

---

### H6. No Rate Limiting

**File:** `artifacts/api-server/src/app.ts`

**Problem:** No rate limiting on any endpoint. The AI generation endpoints are especially vulnerable — each request triggers expensive API calls to Claude, Gemini, and potentially video generation.

**Fix:** Add `express-rate-limit`:
```typescript
import rateLimit from "express-rate-limit";

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Stricter limit for generation endpoints
const generationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
app.use("/api/campaigns/:id/generate", generationLimiter);
```

---

### H7. ElevenLabs Music Generation Uses Wrong Endpoint

**File:** `artifacts/api-server/src/services/elevenlabs.ts`

**Problem:** The code uses the `text-to-sound-effects` endpoint for music generation. ElevenLabs has a separate music generation endpoint.

**Fix:** Use the correct ElevenLabs endpoint for music generation. Check the ElevenLabs API docs for the current music generation endpoint (likely `/v1/music/generate` or similar). Keep the sound effects endpoint for SFX only.

---

### H8. Asset Usage Query Loads All Campaigns Into Memory

**File:** `artifacts/api-server/src/routes/assets.ts`

**Problem:** The `/assets/:id/usage` endpoint loads ALL campaigns into memory and filters with `.filter()` in JavaScript:
```typescript
const allCampaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
const usedIn = allCampaigns.filter(campaign => {
  const selectedAssets = (campaign.selectedAssets || []) as Array<{ assetId: string; role: string }>;
  return selectedAssets.some(a => a.assetId === assetId);
});
```
This is O(n) over all campaigns and will degrade as the database grows.

**Fix:** Either:
- **Option A:** Add a `primaryAssetId` column to the campaigns table for indexed lookups
- **Option B:** Use PostgreSQL JSON query: `WHERE selected_assets @> '[{"assetId": "xxx"}]'::jsonb`
- **Option C:** Create a junction table `campaign_assets(campaign_id, asset_id, role)` for proper relational queries

---

### H9. Client Disconnect Doesn't Cancel In-Flight Operations

**File:** `artifacts/api-server/src/routes/video.ts`

**Problem:** When the SSE client disconnects during video generation, a `clientDisconnected` flag is set, but the actual API calls to Veo and ElevenLabs continue running and consuming credits.

**Fix:** Use `AbortController` to cancel fetch requests when the client disconnects:
```typescript
const abortController = new AbortController();
req.on("close", () => {
  abortController.abort();
});
// Pass abortController.signal to all fetch calls
```

---

### H10. Missing .env.example File

**Problem:** There is no `.env.example` or environment variable documentation in the repo. New developers or deployment processes have no reference for required configuration.

**Fix:** Create a `.env.example` file at the repo root with all required variables:
```
# Core
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/sparqmake
NODE_ENV=development
SESSION_SECRET=change-me-in-production

# Google OAuth
SparqMake_Google_Client_ID=
SparqMake_Google_Client_Secret=
GOOGLE_CALLBACK_URL=/api/auth/google/callback

# AI Services
SparqMake_Anthropic_API_Key=
SparqMake_Gemeni_API_Key=
SparqMake_ElevenLabs_API_Key=
SparqMake_ScreenshotOne_API_Key=

# Social Media OAuth
X_SparqMake_X_API_Key=
SparqMake_Instagram_App_ID=
SparqMake_Instagram_App_Secret=
SparqMake_LinkedIn_Client_ID=
SparqMake_LinkedIn_Client_Secret=

# Token Encryption
TOKEN_ENCRYPTION_KEY=

# Optional
DEV_AUTH_BYPASS=false
LOG_LEVEL=info
CORS_ORIGIN=https://sparqmake.replit.app
```

---

## MEDIUM — Correctness and Reliability Issues

### M1. Variant Review Logs Hardcoded "system" User

**File:** `artifacts/api-server/src/routes/campaign-variants.ts`

**Problem:** When approving or rejecting variants, the refinement log records `userId: "system"` instead of the actual authenticated user:
```typescript
userId: "system",  // Should be req.user.id
```

**Fix:** Use the authenticated user from the request:
```typescript
userId: (req.user as any)?.id || "system",
```

---

### M2. Claude JSON Extraction Uses Fragile Regex

**File:** `artifacts/api-server/src/services/claude.ts`

**Problem:** The caption response from Claude is parsed by extracting JSON with a regex:
```typescript
const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
```
If Claude includes JSON in its explanation text (e.g., "The output format is {...}"), the regex could match the wrong block.

**Fix:** Use Claude's structured output feature (tool use) to guarantee valid JSON, or ask Claude to wrap output in specific delimiters:
```typescript
// Better regex: match only the LAST JSON block
const jsonMatch = textBlock.text.match(/\{[\s\S]*\}(?=[^}]*$)/);
// Or use Claude tool_use for structured output
```

---

### M3. Refinement Analysis JSON Extraction is Fragile

**File:** `artifacts/api-server/src/services/refinement-analysis.ts`

**Problem:** Same fragile regex JSON extraction as M2:
```typescript
const jsonMatch = text.match(/\[[\s\S]*\]/);
```

**Fix:** Same approach — use structured output or more robust parsing.

---

### M4. Reference Analysis Loads Large Files Into Memory

**File:** `artifacts/api-server/src/services/reference-analysis.ts`

**Problem:** Screenshot files are read entirely into memory and converted to base64 for the Gemini API call. Large screenshots could cause memory pressure.

**Fix:** Add a file size check before loading:
```typescript
const stats = fs.statSync(filePath);
if (stats.size > 10 * 1024 * 1024) {
  // Skip or resize files over 10MB
  continue;
}
```

---

### M5. Compositing Failures Are Silent

**Files:**
- `artifacts/api-server/src/routes/generate.ts`
- `artifacts/api-server/src/routes/video.ts`

**Problem:** When Sharp compositing fails, the error is caught silently and the raw image is used as fallback. The user has no idea the composited version (with headline text, gradients, logo) failed.

**Fix:** Log the compositing error and include a warning in the SSE events or variant metadata:
```typescript
catch (compErr) {
  logger.error({ err: compErr }, "Compositing failed, using raw image");
  // Set a flag on the variant
  compositingFailed: true,
}
```

---

### M6. Orphaned Files on Database Save Failure

**File:** `artifacts/api-server/src/routes/generate.ts`

**Problem:** Generated image files are written to disk before the database is updated. If the database insert fails, the files remain on disk with no reference.

**Fix:** Either:
- Write files to a temp directory first, then move to final location after DB save succeeds
- Add a periodic cleanup job that removes files not referenced in the database

---

### M7. OAuth Callback URL Fallback to Localhost

**File:** `artifacts/api-server/src/routes/social-auth.ts`

**Problem:** The `getCallbackBaseUrl()` function falls back to `"http://localhost:3000"` when Replit environment variables aren't set. This breaks all social OAuth in non-Replit deployments.

**Fix:** Add an `APP_URL` environment variable as the primary source:
```typescript
function getCallbackBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPLIT_DOMAINS) return `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
  return "http://localhost:3000";
}
```

---

### M8. Instagram Access Token Passed in URL Parameter

**File:** `artifacts/api-server/src/routes/social-auth.ts`

**Problem:** The Facebook Graph API access token is passed as a URL query parameter:
```typescript
`https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
```
This exposes the token in server logs, CDN logs, and browser history.

**Fix:** Use the Authorization header instead:
```typescript
fetch("https://graph.facebook.com/v19.0/me/accounts", {
  headers: { Authorization: `Bearer ${accessToken}` }
})
```

---

### M9. Calendar Week View Assumes Sunday Start

**File:** `artifacts/sparqmake/src/pages/Calendar.tsx`

**Problem:** Week calculation uses `getDay()` which returns 0 for Sunday (US convention). Users in regions where Monday is the first day of the week will see incorrect week boundaries.

**Fix:** Make the first day of the week configurable, or use a library like `date-fns` with locale support.

---

### M10. CostDashboard Uses Raw fetch() Instead of API Client

**File:** `artifacts/sparqmake/src/pages/CostDashboard.tsx`

**Problem:** Uses raw `fetch()` calls instead of the generated React Query hooks from `@workspace/api-client-react`. This means no automatic retry, cache invalidation, or loading/error state management.

**Fix:** Generate or create hooks for the cost-related endpoints and use them in the CostDashboard component.

---

### M11. Inconsistent API Base URL Handling in Frontend

**Files:** Multiple frontend pages

**Problem:** Some pages use `const API_BASE = import.meta.env.VITE_API_URL || ""` while Calendar.tsx uses relative paths like `/api/calendar-entries`. This inconsistency can cause issues if the API is hosted on a different domain or port.

**Fix:** Standardize all API calls to use the same base URL pattern, ideally through the generated API client.

---

### M12. useAuth Hook Uses Module-Level Mutable State

**File:** `artifacts/sparqmake/src/hooks/useAuth.ts`

**Problem:** Uses module-level variables (`cachedState`, `listeners`) instead of React Context. This can cause race conditions with multiple component mounts, memory leaks from uncleared listeners, and stale state.

**Fix:** Refactor to use React Context + Provider pattern:
```typescript
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // ... fetch auth state, provide via context
}
export function useAuth() {
  return useContext(AuthContext);
}
```

---

## LOW — Code Quality and Hardening

### L1. No API Versioning

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** All routes are mounted at `/api/` with no version prefix. Future breaking changes will require versioning.

**Fix:** Consider mounting at `/api/v1/` for future flexibility.

---

### L2. Hardcoded AI Model Names

**Files:**
- `artifacts/api-server/src/services/claude.ts` — hardcoded `"claude-sonnet-4-6"`
- `artifacts/api-server/src/services/imagen.ts` — hardcoded `"gemini-2.5-flash-image"`
- `artifacts/api-server/src/services/video-generation.ts` — hardcoded `"veo-2.0"`
- `artifacts/api-server/src/routes/rewrite.ts` — hardcoded `"claude-sonnet-4-6"`

**Fix:** Move model names to environment variables or a constants file:
```typescript
export const AI_MODELS = {
  caption: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  image: process.env.IMAGE_MODEL || "gemini-2.5-flash-image",
  video: process.env.VIDEO_MODEL || "veo-2.0",
};
```

---

### L3. Hardcoded Cost Estimates

**File:** `artifacts/api-server/src/services/imagen.ts`

**Problem:** Image generation cost is hardcoded at `$0.06/image`. Actual costs vary by model and resolution.

**Fix:** Move to a configurable cost table, or at minimum to the constants file.

---

### L4. Dev Auth Bypass Creates Persistent DB User

**File:** `artifacts/api-server/src/middleware/auth.ts`

**Problem:** The dev bypass middleware creates a hardcoded user in the database with a fixed ID. This user persists across deployments and could leak if dev credentials are accidentally used in production.

**Fix:** Use a session-only mock user that isn't persisted to the database, or add a clear warning log and ensure `DEV_AUTH_BYPASS` is never set in production.

---

### L5. No 404 Handler for API Routes

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** No explicit 404 handler at the end of the route chain. Unknown API routes return Express's default HTML error page.

**Fix:** Add a catch-all at the end of the router:
```typescript
router.use("/api/*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});
```

---

### L6. Upload Route Allows application/octet-stream

**File:** `artifacts/api-server/src/routes/upload.ts`

**Problem:** The ALLOWED_MIMES list includes `"application/octet-stream"`, which is overly permissive and could allow upload of any file type.

**Fix:** Remove `application/octet-stream` from ALLOWED_MIMES and require clients to send proper MIME types.

---

### L7. SSRF Protection Incomplete for IPv6

**File:** `artifacts/api-server/src/services/screenshot.ts`

**Problem:** The URL validation blocks common private IPv4 ranges but IPv4-mapped IPv6 addresses like `::ffff:192.168.1.1` could bypass the checks.

**Fix:** Add IPv6-mapped private IP checks, or use a library like `is-private-ip` for comprehensive validation.

---

### L8. Dynamic Imports in Request Handlers

**File:** `artifacts/api-server/src/routes/settings.ts`

**Problem:** Dynamic `import()` calls happen per-request in the settings budget check endpoint instead of at module level.

**Fix:** Move imports to the top of the file.

---

### L9. Type Assertions with `as any` in Frontend

**File:** `artifacts/sparqmake/src/pages/ReviewQueue.tsx`

**Problem:** Multiple unsafe `as any` type assertions when calling mutation hooks.

**Fix:** Define proper TypeScript interfaces for all mutation payloads.

---

### L10. Missing Error Logging in Catch Blocks

**Files:** Multiple route and service files

**Problem:** Several catch blocks either silently swallow errors or return generic messages without logging:
- `ReviewQueue.tsx:95` — empty catch block
- `video.ts` — catches without logging
- `rewrite.ts` — returns generic error

**Fix:** Add `logger.error({ err }, "context message")` to all catch blocks.

---

## Architecture Notes (Not Bugs — For Awareness)

### A1. Spec vs. Implementation Mismatch

The original tech spec called for:
- Next.js → **Actually built with:** React + Vite + Express
- Prisma → **Actually built with:** Drizzle ORM
- Imagen 4 Ultra → **Actually built with:** `gemini-2.5-flash-image`
- Veo 3.1 → **Actually built with:** Veo 2.0

These are not bugs — the Replit Agent made valid alternative choices. But the documentation should be updated to match reality.

### A2. Session-Based Auth (No JWT)

The app uses server-side sessions with `connect-pg-simple` (PostgreSQL session store) rather than JWT tokens. This is a valid approach but means:
- Sessions are stateful and tied to the server
- Horizontal scaling requires shared session store (already using PostgreSQL, so this is fine)
- Session cleanup should be configured (default is PostgreSQL cleanup query)

### A3. PostgreSQL Polling for Scheduling

The publish scheduler uses 60-second PostgreSQL polling instead of a job queue (BullMQ/Redis). This is fine for low volume but should be monitored. If scheduling volume grows, migrate to a proper job queue as noted in the checkpoint log.

---

## Summary — Issue Count by Severity

| Severity | Count | Key Impact |
|----------|-------|------------|
| **CRITICAL** | 6 | Login broken, publishing broken, data integrity risk |
| **HIGH** | 10 | Production failures, security vulnerabilities |
| **MEDIUM** | 12 | Correctness issues, silent failures, UX bugs |
| **LOW** | 10 | Code quality, hardening, best practices |
| **TOTAL** | **38** | |

## Recommended Fix Order for Replit Agent

**Phase 1 — Make It Work (Critical):**
1. C1: Fix Google OAuth env var names
2. C2: Fix Twitter media upload auth
3. C3: Fix LinkedIn author URN format
4. C4: Migrate to LinkedIn Community Management API
5. C5: Add foreign key constraints + migration
6. C6: Wrap variant operations in DB transactions

**Phase 2 — Make It Reliable (High):**
7. H1: Fix budget race condition with DB locking
8. H2: Add Instagram Story publishing flow
9. H3: Ensure public URLs for Instagram images
10. H4: Restrict CORS to known origins
11. H5: Add CSRF protection
12. H6: Add rate limiting
13. H7: Fix ElevenLabs music endpoint
14. H8: Optimize asset usage query
15. H9: Cancel in-flight ops on client disconnect
16. H10: Create .env.example

**Phase 3 — Make It Correct (Medium):**
17–28: Address M1 through M12 in order

**Phase 4 — Make It Solid (Low):**
29–38: Address L1 through L10 in order

---

*Generated by codebase audit on March 20, 2026. Excludes TikTok/YouTube gaps (see TIKTOK_PHASE5_PROMPT.md).*
