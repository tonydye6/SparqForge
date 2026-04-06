# SparqMake™ — Codebase Gap Analysis V3

**Date:** March 23, 2026
**Scope:** Full re-audit of https://github.com/tonydye6/SparqMake after Tasks #26–28
**Purpose:** Identify every remaining issue. Supersedes V1 and V2.
**Exclusions:** TikTok and YouTube integration (tracked separately).

---

## Progress Summary

The Replit Agent has done excellent work across Tasks #21–28. Here's the full scorecard from the original 38 V1 issues + 27 V2 issues:

### V2 Issues Resolved in Tasks #26–28

| V2 Issue | Status |
|----------|--------|
| C1: LinkedIn URN stored incorrectly | ✅ FIXED — Now stores `urn:li:person:{sub}` at OAuth callback |
| C2: Instagram token in URL | ✅ FIXED — Documented as Facebook API requirement, URL not logged |
| C3: CSRF unauthenticated edge case | ✅ FIXED — All state-changing requests without Origin/Referer blocked |
| H1: Missing GIN index | ✅ FIXED — Migration `0002_add_gin_index_selected_assets.sql` created |
| H2: Publish scheduler no transaction | ✅ FIXED — Claim and status update both wrapped in transactions |
| H3: Backfill-assets no transaction | ✅ FIXED — All updates wrapped in single transaction |
| H4: CSV parsing fragile | ✅ FIXED — Now uses `csv-parse` library |
| H5: Brand matching too permissive | ✅ FIXED — Now exact match (`===`) instead of substring |
| H6: File serving no rate limit | ✅ FIXED — 60 req/min dedicated limiter |
| H7: Twitter OAuth 1.0a credentials | ✅ FIXED — Reads from env vars with validation and docs |
| M2: Claude JSON fragile | ✅ FIXED — New `extract-json.ts` utility with multi-method parsing |
| M3: Compositing warnings not surfaced | ✅ FIXED — Warnings sent via SSE `compositing_warning` events |
| M4: CampaignStudio silent errors | ✅ FIXED — Toast notifications on all error catches |
| M5: ReviewQueue silent errors | ✅ FIXED — Toast notifications on approve/reject failures |
| M7: AssetLibrary inconsistent API URL | ✅ FIXED — Consistent `API_BASE` usage |
| M8: Upload allows octet-stream | ✅ FIXED — Removed from ALLOWED_MIMES |
| L1: Hardcoded AI model names | ✅ FIXED — Configurable via `ai-config.ts` + env vars |
| L2: Hardcoded cost estimates | ✅ FIXED — Configurable via env vars |
| L5: Missing .env entries for AI | ✅ FIXED — Anthropic + Gemini + model overrides added |
| L7: No 404 handler | ✅ FIXED — Catch-all returns JSON 404 |

**Remaining V2 issues still open: 7**

---

## Remaining Issues (10 Total)

### MEDIUM — Correctness Issues

#### M1. Hardcoded "system" userId in Refinement Logs

**Files:**
- `artifacts/api-server/src/routes/campaign-variants.ts` — line 98
- `artifacts/api-server/src/routes/generate.ts` — lines 525, 614, 748

**Problem:** Four places in the codebase log refinement actions with `userId: "system"` instead of the actual authenticated user. The campaign-variants fix (line 98) was partially applied — it now reads `(req as any).user?.id || "system"` — but the three instances in generate.ts still hardcode `"system"`.

**Impact:** Audit trails for caption edits, headline edits, and image regeneration don't capture who made the change. This makes review history unreliable.

**Fix:** In generate.ts, extract the user from the request and pass it through:
```typescript
// At top of each handler:
const userId = (req as any).user?.id || "system";

// Then use it in refinement logs:
userId,
```

Apply to all three locations: lines 525, 614, and 748.

---

#### M2. Brand Matching Falls Back to First Brand

**File:** `artifacts/api-server/src/routes/content-plan.ts` (~lines 268-272)

**Problem:** When CSV import can't match a brand by exact name, it silently falls back to the first brand in the database. This could assign content to the wrong brand without any warning.

**Fix:** Either:
- Return an error for unmatched brand names
- Log a warning and skip the row
- Add a `defaultBrandId` setting and use that explicitly

```typescript
if (!match) {
  skippedRows.push({ row: idx, reason: `Brand "${planItem.brandLayer}" not found` });
  continue;
}
```

---

#### M3. Content Plan Missing Pagination

**File:** `artifacts/api-server/src/routes/content-plan.ts`

**Problem:** The GET endpoint returns all plan items without pagination. Will return increasingly large payloads as the content plan grows.

**Fix:** Add `limit` and `offset` query parameters with sensible defaults:
```typescript
const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
const offset = parseInt(req.query.offset as string) || 0;
```

---

#### M4. File Copy After DB Commit in Regeneration

**File:** `artifacts/api-server/src/routes/generate.ts` (~lines 755-769)

**Problem:** During variant regeneration, the database is updated inside a transaction (lines 722-753), then files are copied AFTER the transaction commits (lines 756-757). If `fs.copyFileSync` fails, the DB already has the new URLs pointing to non-existent files. The error handler (lines 758-768) tries to roll back the DB URLs, but this is a separate non-transactional update that could also fail.

**Fix:** Copy files to their final location BEFORE the DB transaction, or use a two-phase approach:
1. Copy files to final paths
2. If copy succeeds, update DB in transaction
3. If DB update fails, clean up copied files

---

#### M5. Google Callback URL Falls Back to Relative Path

**File:** `artifacts/api-server/src/lib/passport.ts` (line 53)

**Problem:** `resolveGoogleCallbackUrl()` falls back to the relative path `/api/auth/google/callback` when no environment variables are set. While Passport.js can resolve this against the request URL, this can fail behind certain reverse proxies or load balancers that don't forward the correct host header.

**Fix:** Add a startup warning if the callback URL is relative:
```typescript
if (GOOGLE_CALLBACK_URL === callbackPath) {
  logger.warn("Google OAuth callback URL is relative — set APP_URL or GOOGLE_CALLBACK_URL for reliable behavior behind proxies");
}
```

---

### LOW — Code Quality

#### L1. No API Versioning

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** Routes are mounted at `/api/` with no version prefix.

**Fix:** Consider mounting at `/api/v1/` for future-proofing. Non-urgent but good practice for a production API.

---

#### L2. Dev Auth Bypass Creates Persistent DB User

**File:** `artifacts/api-server/src/middleware/auth.ts` (lines 16-34)

**Problem:** The dev bypass middleware creates a hardcoded user in the actual database. The production guard (line 38-41) prevents bypass in production, which is good. But the persistent user record remains in the DB even after bypass is disabled.

**Fix:** This is acceptable as-is since the production guard works. For extra safety, add a cleanup migration or startup check that removes the dev user when `DEV_AUTH_BYPASS` is not active:
```typescript
if (!isDevBypass()) {
  // Optionally clean up dev user from DB
  await db.delete(usersTable).where(eq(usersTable.id, DEV_USER.id));
}
```

---

#### L3. extract-json.ts Greedy Regex Edge Case

**File:** `artifacts/api-server/src/lib/extract-json.ts`

**Problem:** The regex `/\{[\s\S]*\}/` is greedy and matches from the FIRST `{` to the LAST `}` in the text. If Claude returns multiple JSON objects in its response, the regex will try to parse everything between the first and last brace as a single object, which will fail.

**Fix:** Use a non-greedy approach or match the LAST complete JSON block:
```typescript
// Try to find complete JSON blocks by tracking brace depth
function findJsonBlock(text: string): string | null {
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    if (text[i] === '}') { depth--; if (depth === 0 && start >= 0) return text.slice(start, i + 1); }
  }
  return null;
}
```

---

#### L4. H8 Fallback Brand Matching Loads All Brands

**File:** `artifacts/api-server/src/routes/content-plan.ts` (~line 258)

**Problem:** Brand matching loads ALL brands into memory for each CSV import, then filters in JavaScript. Should use a database query:
```typescript
const [match] = await db.select().from(brandsTable)
  .where(or(eq(brandsTable.name, layerKey), eq(brandsTable.slug, layerKey)))
  .limit(1);
```

---

#### L5. Scheduler Error Classification

**File:** `artifacts/api-server/src/services/publish-scheduler.ts`

**Problem:** All publish failures get the same retry treatment. A 400 Bad Request (permanent failure) retries the same way as a 503 Service Unavailable (transient failure), wasting API credits on requests that will never succeed.

**Fix:** Classify errors by HTTP status code:
```typescript
const isPermanent = statusCode >= 400 && statusCode < 500 && statusCode !== 429;
if (isPermanent) {
  // Mark as failed, don't retry
} else {
  // Schedule retry with exponential backoff
}
```

---

## Summary — Final Issue Count

| Severity | Count | Key Impact |
|----------|-------|------------|
| **CRITICAL** | 0 | All critical issues resolved! |
| **MEDIUM** | 5 | Audit trail gaps, edge cases, data integrity |
| **LOW** | 5 | Code quality, future-proofing |
| **TOTAL** | **10** | (down from 38 in V1, 27 in V2) |

---

## Recommended Fix Order

**Phase 1 — Quick Wins (30 min):**
1. M1: Fix hardcoded "system" userId in generate.ts (3 lines)
2. M5: Add warning for relative Google callback URL (2 lines)
3. L3: Improve extract-json.ts regex (optional)

**Phase 2 — Data Correctness (1 hr):**
4. M2: Fix brand matching fallback (return error instead of default brand)
5. M4: Reorder file copy and DB commit in regeneration flow
6. L5: Add error classification to scheduler retry logic

**Phase 3 — Quality Polish (optional):**
7. M3: Add content plan pagination
8. L1: API versioning prefix
9. L2: Dev user cleanup
10. L4: Database-level brand query

---

## What's Working Well

The codebase is in strong shape. Key strengths:

- **Security:** CORS allowlist, CSRF protection, rate limiting (global + per-endpoint), SSRF protection, path traversal prevention, token encryption (AES-256-GCM), production guards on dev bypass
- **Auth:** Google OAuth with both naming conventions, multi-source callback URL resolution, proper session management with PostgreSQL store
- **Database:** Foreign keys with cascade behavior, advisory locks for budget, GIN index for JSONB queries, transaction wrapping on critical operations
- **AI Pipeline:** Configurable models and costs, robust JSON extraction, compositing with warning propagation, SSE progress events
- **Publishing:** OAuth 1.0a for Twitter, Community Management API for LinkedIn, Story-specific flow for Instagram, transaction-wrapped scheduler with retry
- **Frontend:** React Context auth, toast notifications for errors, consistent API base URLs, proper error boundaries

**Verdict:** The app is approaching production-ready state. The 10 remaining issues are all Medium or Low severity — no blockers.

---

*Generated by codebase re-audit on March 23, 2026. Supersedes V1 and V2.*
*Excludes TikTok/YouTube gaps (see TIKTOK_PHASE5_PROMPT.md).*
