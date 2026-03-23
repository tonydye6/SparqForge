# SparqForge™ — Codebase Gap Analysis V2 (Post-Fix Audit)

**Date:** March 21, 2026
**Scope:** Full re-audit of https://github.com/tonydye6/SparqForge after Tasks #17–24
**Purpose:** Identify every remaining issue preventing features from working flawlessly. Supersedes V1.
**Exclusions:** TikTok and YouTube integration (tracked separately).

---

## What Was Fixed Since V1

The Replit Agent addressed many of the original 38 issues across Tasks #21–24. Here's the scorecard:

| Original Issue | Status | Notes |
|----------------|--------|-------|
| C1: Google OAuth env var mismatch | ✅ FIXED | Both naming conventions checked in passport.ts and auth.ts |
| C2: Twitter media upload auth | ✅ FIXED | Proper OAuth 1.0a signing implemented |
| C3: LinkedIn URN format | ⚠️ BAND-AID | Defensive `ensurePersonUrn()` added at publish time; root storage not fixed |
| C4: LinkedIn deprecated API | ✅ FIXED | Now uses Community Management API with correct headers |
| C5: No foreign key constraints | ✅ FIXED | FK constraints with cascade/set null added to all schema |
| C6: Variant deletion no transaction | ✅ FIXED | Wrapped in proper DB transaction |
| H1: Budget race condition | ✅ FIXED | PostgreSQL advisory lock implemented |
| H2: Instagram Story flow | ✅ FIXED | Proper branching with `media_type: "STORIES"` |
| H3: Instagram public URLs | ✅ FIXED | `resolvePublicImageUrl()` with multi-source fallback |
| H4: CORS too permissive | ✅ FIXED | Proper allowlist via `getAllowedOriginStrings()` |
| H5: No CSRF protection | ✅ FIXED | Origin/Referer header validation middleware added |
| H6: No rate limiting | ✅ FIXED | Global (200/min) + generation-specific (5/min) limits |
| H7: ElevenLabs wrong endpoint | ✅ FIXED | `/text-to-music` for music, `/sound-generation` for SFX |
| H8: Asset usage O(n) query | ⚠️ IMPROVED | Uses JSONB `@>` operator but no GIN index |
| H9: Client disconnect cancel | Needs verification | |
| H10: Missing .env.example | ✅ FIXED | Comprehensive .env.example created |
| M1: Hardcoded "system" user | ❌ NOT FIXED | Still `userId: "system"` in campaign-variants.ts:98 |
| M2: Claude JSON regex fragile | ⚠️ IMPROVED | Strips markdown fences, but still uses greedy regex |
| M3: Reference analysis JSON | ✅ FIXED | Proper error handling with context |
| M4: Reference analysis memory | ✅ FIXED | |
| M5: Compositing failures silent | ⚠️ PARTIAL | Errors logged but operation continues without user notification |
| M7: OAuth callback URL fallback | ✅ FIXED | Multi-source URL resolution |
| M8: Instagram token in URL | ❌ NOT FIXED | `fb_exchange_token` still passed as URL query param |
| M12: useAuth module-level state | ✅ FIXED | Refactored to React Context + Provider |
| L7: SSRF IPv6 protection | ✅ FIXED | Comprehensive IPv4/IPv6 private range checks |

**Summary: 19 of 38 original issues fully fixed, 4 partially fixed, 3 not fixed, rest addressed.**

---

## How to Use This Document

Each remaining and new issue is categorized by severity. Replit Agent should:
1. Fix all **CRITICAL** issues first (app-breaking bugs)
2. Then **HIGH** issues (production failures)
3. Then **MEDIUM** issues (correctness / reliability)
4. Then **LOW** issues (code quality / hardening)

---

## CRITICAL — App-Breaking Issues

### C1. LinkedIn Author URN Stored Incorrectly at Source

**File:** `artifacts/api-server/src/routes/social-auth.ts` (LinkedIn OAuth callback)

**Problem:** When a user connects their LinkedIn account, the `accountId` stores the raw OpenID `sub` claim. The `ensurePersonUrn()` band-aid in `publish-linkedin.ts` patches this at publish time, but the root data is wrong. If any other feature reads `accountId` expecting a URN, it will break.

**Fix:** Fix at the source — in the LinkedIn OAuth callback in `social-auth.ts`, store the URN correctly:
```typescript
accountId: `urn:li:person:${profileData.sub}`,
```
Then the `ensurePersonUrn()` wrapper becomes a safety net rather than the primary fix.

---

### C2. Instagram Token Passed in URL Query Parameter

**File:** `artifacts/api-server/src/routes/social-auth.ts` (~line 225)

**Problem:** During Instagram long-lived token exchange, the `fb_exchange_token` is passed as a URL query parameter:
```typescript
longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);
```
This exposes the token in server logs, CDN logs, and any network monitoring tool. This is a security vulnerability.

**Fix:** The Facebook Graph API for token exchange requires query parameters (it's a GET request), so instead ensure:
- Server logs do NOT log full URLs for this endpoint (redact query params)
- Add a comment documenting why this is a GET with token in URL (Facebook API requirement)
- Immediately discard the short-lived token after exchange succeeds

---

### C3. CSRF Allows Unauthenticated State-Changing Requests Without Origin Header

**File:** `artifacts/api-server/src/middleware/csrf.ts` (line 66)

**Problem:** When a state-changing request (POST/PUT/DELETE) arrives with NO Origin header AND the user is NOT authenticated, the middleware calls `next()` and allows it through. While `requireAuth` will block most routes, any unprotected routes (health, auth, file serving) would accept these requests.

**Current flow:**
1. No Origin/Referer → Check if authenticated → If NOT → `next()` (allows through)

**Risk:** The `/api/auth/google` and `/api/auth/google/callback` routes are already exempted from CSRF. But if new unprotected routes are added in the future, they'll be vulnerable. The file serving endpoint (`/api/files/generated/:filename`) is GET-only so it's safe, but this is a latent risk.

**Fix:** For defense in depth, block ALL state-changing requests without Origin/Referer regardless of auth status, except explicitly exempted callback paths:
```typescript
// Replace lines 60-66 with:
logger.warn({ path: req.path }, "CSRF check: request missing Origin/Referer");
res.status(403).json({ error: "Forbidden: missing origin header" });
return;
```

---

## HIGH — Production Failure Risks

### H1. Asset Usage Query Lacks GIN Index (Performance Degradation)

**File:** `artifacts/api-server/src/routes/assets.ts` (~line 401)

**Problem:** The JSONB containment query `@>` was added (improvement over loading all campaigns), but without a GIN index on `campaigns.selected_assets`, PostgreSQL must do a sequential scan on every query.

**Fix:** Add a GIN index via Drizzle migration:
```sql
CREATE INDEX idx_campaigns_selected_assets ON campaigns USING GIN (selected_assets jsonb_path_ops);
```
Or in Drizzle schema:
```typescript
// In campaigns.ts, add to table definition or as separate index
export const campaignsSelectedAssetsIdx = index("idx_campaigns_selected_assets")
  .on(campaignsTable.selectedAssets)
  .using("gin");
```

---

### H2. Publish Scheduler Missing Transaction Wrapper

**File:** `artifacts/api-server/src/services/publish-scheduler.ts`

**Problem:** The `publishEntry()` function performs multiple sequential database operations (status updates, retry tracking, etc.) without a transaction. If the process crashes between operations, entries can end up in inconsistent states (e.g., marked "publishing" but never completed).

**Fix:** Wrap the critical state transitions in a transaction:
```typescript
await db.transaction(async (tx) => {
  // Update status to "publishing"
  // Perform publish
  // Update status to "published" or "failed"
});
```

---

### H3. Backfill-Assets Service Missing Transaction

**File:** `artifacts/api-server/src/services/backfill-assets.ts`

**Problem:** The backfill service loads ALL assets into memory and updates them one-by-one without a transaction. If the process crashes mid-loop, some assets have updated classifications while others don't, creating an inconsistent state.

**Fix:** Wrap in a transaction, or at minimum add an idempotency check so re-running the backfill is safe:
```typescript
await db.transaction(async (tx) => {
  for (const asset of assets) {
    await tx.update(assetsTable).set(updates).where(eq(assetsTable.id, asset.id));
  }
});
```

---

### H4. Content Plan CSV Parsing Has Edge Cases

**File:** `artifacts/api-server/src/routes/content-plan.ts` (~lines 42-96)

**Problem:** The CSV parsing includes custom logic for handling commas inside the `core_message` field, but the implementation is fragile:
- If `core_message` contains commas AND there are other columns after it, the merge logic may produce incorrect results
- Quoted fields with embedded commas won't be handled correctly by the simple split logic

**Fix:** Use a proper CSV parser library (like `csv-parse` or `papaparse`) instead of manual splitting:
```typescript
import { parse } from "csv-parse/sync";
const records = parse(csvContent, { columns: true, skip_empty_lines: true });
```

---

### H5. Content Plan Brand Matching Too Permissive

**File:** `artifacts/api-server/src/routes/content-plan.ts` (~line 320)

**Problem:** Brand matching uses bidirectional substring matching:
```typescript
return matchNames.some(m => bName.includes(m) || m.includes(bName) || bSlug === m)
```
The `m.includes(bName)` check means a brand named "sparq" would match an import row for "sparqforge" — unrelated brands could be matched.

**Fix:** Use exact match or prefix match only:
```typescript
return matchNames.some(m => bName === m || bSlug === m || bName.startsWith(m));
```

---

### H6. File Serving Endpoint Lacks Rate Limiting

**File:** `artifacts/api-server/src/app.ts` (~lines 82-94)

**Problem:** The `/api/files/generated/:filename` endpoint serves generated images without authentication (needed for Instagram to fetch images) and without any rate limiting. This could be exploited for DoS.

**Fix:** Add a dedicated rate limiter for this endpoint:
```typescript
const fileServingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,  // 60 requests per minute per IP
  message: { error: "Too many file requests" },
});
app.use("/api/files", fileServingLimiter);
```

---

### H7. Twitter OAuth 1.0a Credentials May Not Be Stored

**File:** `artifacts/api-server/src/services/publish-twitter.ts` (~lines 18-29)

**Problem:** The OAuth 1.0a fix in `publish-twitter.ts` calls `getOAuth1Credentials()` which requires separate OAuth 1.0a access tokens (consumer key/secret + user access token/secret). However, the social auth flow in `social-auth.ts` stores OAuth 2.0 tokens from the PKCE flow. The OAuth 1.0a user-level tokens may never be captured or stored.

**Fix:** Verify that:
1. The Twitter app has both OAuth 1.0a and OAuth 2.0 access enabled in the Twitter Developer Portal
2. The social auth callback stores BOTH the OAuth 2.0 bearer token AND the OAuth 1.0a access token/secret
3. The `getOAuth1Credentials()` function can actually retrieve these from storage or env vars

If OAuth 1.0a tokens aren't stored per-user, consider using app-level OAuth 1.0a credentials with user context, or switch to the Twitter v2 media upload endpoint if available.

---

## MEDIUM — Correctness and Reliability Issues

### M1. Variant Review Logs Hardcoded "system" User (UNFIXED FROM V1)

**File:** `artifacts/api-server/src/routes/campaign-variants.ts` (line 98)

**Problem:** Still logs `userId: "system"` instead of the actual user.

**Fix:**
```typescript
userId: (req.user as any)?.id || "system",
```

---

### M2. Claude JSON Extraction Still Fragile

**File:** `artifacts/api-server/src/services/claude.ts` (~line 124)

**Problem:** The regex `/\{[\s\S]*\}/` is greedy and matches from first `{` to last `}`. If Claude includes JSON examples in its explanation text, the regex could capture the wrong block.

Improvement: Markdown fences are now stripped before extraction, which helps. But the fundamental approach is still fragile.

**Fix:** Use Claude's tool_use feature for structured output, or implement a JSON extraction function that validates the parsed result:
```typescript
function extractJSON(text: string): object | null {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Try to parse directly first
  try { return JSON.parse(cleaned); } catch {}
  // Then try regex extraction
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}
```

---

### M3. Compositing Failures Are Not Surfaced to Users

**File:** `artifacts/api-server/src/services/compositing.ts` (~line 213)

**Problem:** When logo processing fails during compositing, the error is caught and logged, but the composited image is produced without the logo. The user sees a "complete" image with no indication that the logo is missing.

**Fix:** Add a `warnings` array to the compositing result:
```typescript
return {
  compositedPath: outputPath,
  warnings: logoFailed ? ["Logo could not be applied — check logo file format"] : [],
};
```
Surface these warnings in the SSE progress events so the frontend can display them.

---

### M4. CampaignStudio Has Multiple Silent Error Catches

**File:** `artifacts/sparqforge/src/pages/CampaignStudio.tsx`

**Problem:** Several fetch operations catch errors silently without user feedback:
- Line ~140: `fetchRecommended` — silently fails (user sees no recommendations with no explanation)
- Line ~301: `checkDuplicate` — silently fails

**Fix:** Add toast notifications or inline error messages for failed operations:
```typescript
catch (err) {
  console.error("Failed to fetch recommendations:", err);
  toast.error("Could not load recommendations");
}
```

---

### M5. ReviewQueue Approve/Reject Failures Are Silent

**File:** `artifacts/sparqforge/src/pages/ReviewQueue.tsx` (~lines 170, 192)

**Problem:** When variant approval or rejection API calls fail, the error is caught silently. The user clicks "Approve" and nothing happens — no success confirmation, no error message.

**Fix:** Add proper error handling with user feedback:
```typescript
catch (err) {
  toast.error("Failed to approve variant. Please try again.");
}
```

---

### M6. Content Plan Missing Pagination

**File:** `artifacts/api-server/src/routes/content-plan.ts`

**Problem:** The GET endpoint returns ALL plan items without pagination. As the content plan grows, this will return increasingly large payloads.

**Fix:** Add `limit` and `offset` query parameters:
```typescript
const limit = parseInt(req.query.limit as string) || 50;
const offset = parseInt(req.query.offset as string) || 0;
// Add .limit(limit).offset(offset) to query
```

---

### M7. AssetLibrary Uses Inconsistent API Base URL

**File:** `artifacts/sparqforge/src/pages/AssetLibrary.tsx` (~line 148)

**Problem:** The `bulkUpdate` function uses a relative URL `/api/assets/bulk-update` instead of the `API_BASE` variable used elsewhere in the same component. This inconsistency could break if the API is served from a different origin.

**Fix:** Use `${API_BASE}/api/assets/bulk-update` consistently.

---

### M8. No Content-Type Validation on Upload

**File:** `artifacts/api-server/src/routes/upload.ts`

**Problem:** While `ALLOWED_MIMES` is defined, it includes `application/octet-stream` which matches any binary file. A malicious user could upload executables or scripts with this MIME type.

**Fix:** Remove `application/octet-stream` from ALLOWED_MIMES and require proper MIME types.

---

## LOW — Code Quality and Hardening

### L1. Hardcoded AI Model Names

**Files:**
- `artifacts/api-server/src/services/claude.ts` — `"claude-sonnet-4-6"`
- `artifacts/api-server/src/services/imagen.ts` — `"gemini-2.5-flash-image"`
- `artifacts/api-server/src/services/video-generation.ts` — `"veo-2.0"`

**Fix:** Move to environment variables or a constants file for easy updates.

---

### L2. Hardcoded Cost Estimates

**Files:**
- `artifacts/api-server/src/services/imagen.ts` — `$0.06/image`
- `artifacts/api-server/src/services/elevenlabs.ts` — `$0.15` (hardcoded, no parameters)

**Fix:** Move to configurable settings or compute based on actual API pricing.

---

### L3. Multiple `as any` Type Assertions in Frontend

**Files:** CampaignStudio.tsx, ReviewQueue.tsx, Settings.tsx, AssetLibrary.tsx

**Problem:** Multiple unsafe `as any` casts throughout frontend code that bypass TypeScript's type system.

**Fix:** Define proper interfaces for all API responses and mutation payloads.

---

### L4. No API Versioning

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** All routes at `/api/` with no version prefix.

**Fix:** Consider `/api/v1/` for future flexibility.

---

### L5. Missing .env.example Entries for AI Services

**File:** `.env.example`

**Problem:** The `.env.example` doesn't include entries for the Anthropic API key (Claude) or Google AI API key (Gemini/Veo), which are required for the core generation pipeline.

**Fix:** Add:
```
# ---------- AI Services ----------
# SparqForge_Anthropic_API_Key=
# SparqForge_Gemeni_API_Key=
# SparqForge_ElevenLabs_API_Key=
```

---

### L6. Dev Auth Bypass Creates Persistent DB User

**File:** `artifacts/api-server/src/middleware/auth.ts`

**Problem:** The dev bypass middleware creates a user in the database with a fixed ID that persists across deployments.

**Fix:** Use session-only mock user, or add startup warning and production guard.

---

### L7. No 404 Handler for Unknown API Routes

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** Unknown API routes return Express's default HTML error page instead of a JSON response.

**Fix:**
```typescript
router.use("/api/*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});
```

---

### L8. Scheduler Doesn't Differentiate Transient vs Permanent Failures

**File:** `artifacts/api-server/src/services/publish-scheduler.ts`

**Problem:** All publish failures get the same retry treatment. Invalid content (permanent failure) retries just like a temporary API outage (transient failure), wasting API credits.

**Fix:** Classify errors:
- **Transient** (retry): network timeouts, 429 rate limits, 5xx errors
- **Permanent** (don't retry): 400 bad request, 401 unauthorized, invalid content

---

### L9. Google Callback URL Still Relative

**File:** `artifacts/api-server/src/lib/passport.ts`

**Problem:** `GOOGLE_CALLBACK_URL` defaults to the relative path `/api/auth/google/callback`. While this works on Replit (Passport resolves it against the request URL), it could fail behind certain reverse proxies.

**Fix:** Default to an absolute URL constructed from `APP_URL` or Replit env vars.

---

## Summary — Issue Count by Severity

| Severity | Count | Key Impact |
|----------|-------|------------|
| **CRITICAL** | 3 | LinkedIn data integrity, token exposure, CSRF edge case |
| **HIGH** | 7 | Missing DB indexes, no transactions, CSV parsing, rate limiting gaps |
| **MEDIUM** | 8 | Silent errors, no pagination, fragile JSON parsing, UX gaps |
| **LOW** | 9 | Hardcoded values, type safety, dev hygiene |
| **TOTAL** | **27** | (down from 38 in V1) |

---

## Recommended Fix Order for Replit Agent

**Phase 1 — Critical Data & Security (3 issues):**
1. C1: Store LinkedIn URN correctly at OAuth callback
2. C2: Redact Instagram token exchange URLs in logs
3. C3: Tighten CSRF to block all state-changing requests without Origin

**Phase 2 — Production Reliability (7 issues):**
4. H1: Add GIN index on `campaigns.selected_assets`
5. H2: Wrap publish scheduler state changes in transaction
6. H3: Add transaction to backfill-assets
7. H4: Replace manual CSV parsing with proper library
8. H5: Fix content plan brand matching (exact match only)
9. H6: Add rate limiting to file serving endpoint
10. H7: Verify Twitter OAuth 1.0a credentials are stored/available

**Phase 3 — Correctness & UX (8 issues):**
11. M1: Fix hardcoded "system" userId in variant reviews
12. M2: Improve Claude JSON extraction robustness
13. M3: Surface compositing warnings to users
14. M4: Add error toasts to CampaignStudio silent catches
15. M5: Add error toasts to ReviewQueue approve/reject
16. M6: Add pagination to content plan API
17. M7: Fix AssetLibrary API base URL inconsistency
18. M8: Remove `application/octet-stream` from upload ALLOWED_MIMES

**Phase 4 — Code Quality (9 issues):**
19–27: L1 through L9 in order

---

## What Was Fixed Well (Kudos to Replit Agent)

The following fixes were implemented correctly and thoroughly:
- **OAuth 1.0a for Twitter** — Proper HMAC-SHA1 signing with 3-step media upload
- **Foreign key constraints** — All relationships now have proper cascading deletes
- **Database transactions** — Generation pipeline properly atomic
- **Advisory locks** — Budget race condition eliminated
- **Instagram Stories** — Clean branching for Feed vs Story publishing
- **CORS allowlist** — Dynamic origin validation with dev/prod separation
- **CSRF middleware** — Clean header-based validation with proper callback exemptions
- **Rate limiting** — Sensible global and per-endpoint limits
- **SSRF protection** — Comprehensive IPv4/IPv6 private range blocking
- **useAuth refactor** — Proper React Context pattern
- **LinkedIn API migration** — Community Management API with version headers
- **.env.example** — Well-documented with all credential categories

---

*Generated by codebase re-audit on March 21, 2026. Supersedes CODEBASE_GAP_ANALYSIS.md (V1).*
*Excludes TikTok/YouTube gaps (see TIKTOK_PHASE5_PROMPT.md).*
