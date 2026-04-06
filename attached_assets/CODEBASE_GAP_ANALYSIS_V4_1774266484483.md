# SparqMake™ — Codebase Gap Analysis V4 (Final)

**Date:** March 23, 2026
**Scope:** Full re-audit of https://github.com/tonydye6/SparqMake after latest commits
**Purpose:** Identify every remaining issue. Supersedes V1, V2, and V3.
**Exclusions:** TikTok and YouTube integration (tracked separately).

---

## Progress Summary

### V3 Issues Resolved Since Last Audit

| V3 Issue | Status | Evidence |
|----------|--------|---------|
| M1: Hardcoded "system" userId in generate.ts | ✅ FIXED | Lines 525, 614, 759 now use `(req as any).user?.id \|\| "system"` |
| M2: Brand matching falls back to first brand | ✅ FIXED | Returns 400 error with message when brand not found (line 269) |
| M3: Content plan missing pagination | ⚠️ NOT FIXED | GET endpoint still returns all items |
| M4: File copy after DB commit | ✅ FIXED | Files now copied BEFORE DB transaction (lines 720-727), with cleanup on failure |
| M5: Google callback URL relative path warning | ✅ FIXED | Warning logged when URL doesn't start with "http" (passport.ts line 58-60) |
| L1: No API versioning | ✅ FIXED | `/api/v1/` prefix rewrite middleware added (app.ts lines 78-83) |
| L2: Dev auth bypass persistent user | ✅ FIXED | Cleanup query runs on startup when bypass disabled (auth.ts lines 51-59) |
| L3: extract-json.ts greedy regex | ✅ FIXED | Replaced with depth-tracking `findJsonBlock()` that handles nested braces and string escapes |
| L4: Brand matching loads all brands | ✅ FIXED | Now uses `db.select().from(brandsTable).where(or(eq(...), eq(...))).limit(1)` |
| L5: Scheduler error classification | ✅ FIXED | `isPermanentFailure()` classifies 4xx (except 429) as permanent, sets retryCount to MAX |

**9 of 10 V3 issues fully resolved. 1 remaining (pagination).**

---

## What Was Fixed Well

The code quality improvements in this round are impressive:

- **extract-json.ts** — The brace-depth tracking parser with string escape awareness is robust. Handles nested JSON, string literals containing braces, and escape sequences correctly. Falls back through three parsing strategies (direct parse → object block → array block).

- **Publish scheduler** — Now has proper transactional claim logic (optimistic locking on status), permanent vs transient error classification, and structured logging with retry counts.

- **File-before-DB ordering in regeneration** — Files are copied to final paths first (lines 720-727), with cleanup on copy failure. DB transaction only runs after files are safely in place. This eliminates the data integrity risk.

- **API versioning middleware** — Clean `/api/v1/` → `/api/` rewrite (app.ts lines 78-83) allows clients to use versioned URLs while maintaining backward compatibility.

- **CSRF tightened** — Now unconditionally blocks all state-changing requests missing Origin/Referer (no unauthenticated passthrough).

- **Dev user cleanup** — auth.ts lines 51-59 auto-delete the dev bypass user from the database when bypass is disabled.

- **Content plan brand matching** — Database-level query with `eq()` instead of in-memory filtering. Returns explicit 400 error for unmatched brands.

---

## Remaining Issues (4 Total)

### MEDIUM

#### M1. Content Plan GET Endpoint Missing Pagination

**File:** `artifacts/api-server/src/routes/content-plan.ts`

**Problem:** The GET `/content-plan` endpoint returns all plan items without `limit` or `offset` parameters. As the content plan grows to hundreds or thousands of items, this will return increasingly large payloads and slow down the frontend.

**Fix:**
```typescript
const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
const offset = parseInt(req.query.offset as string) || 0;

const items = await db.select().from(socialContentPlanItemsTable)
  .orderBy(desc(socialContentPlanItemsTable.scheduledDate))
  .limit(limit)
  .offset(offset);

// Also return total count for frontend pagination UI
const [{ count }] = await db.select({ count: sql`count(*)` }).from(socialContentPlanItemsTable);

res.json({ items, total: Number(count), limit, offset });
```

**Note:** The frontend ContentPlan page will also need updating to handle paginated responses.

---

#### M2. CORS Allows All Origins When Origin Header Is Missing

**File:** `artifacts/api-server/src/app.ts` (lines 39-42)

**Problem:** When a request has no `Origin` header, CORS allows it through unconditionally:
```typescript
if (!origin) {
  callback(null, true);
  return;
}
```
This is standard behavior (same-origin requests and non-browser clients don't send Origin), but combined with cookie-based auth, it means any server-side tool or script can make authenticated requests if it has the session cookie. The CSRF middleware mitigates this for state-changing requests, but GET requests are unprotected.

**Risk:** Low — CSRF covers POST/PUT/DELETE, and session cookies have `httpOnly` + `sameSite: lax`. This is a defense-in-depth consideration, not an active vulnerability.

**Fix (optional):** Add a log warning for authenticated GET requests without Origin in non-dev environments, or document this as accepted behavior.

---

### LOW

#### L1. No API Versioning in Internal Routes

**File:** `artifacts/api-server/src/routes/index.ts`

**Problem:** The `/api/v1/` rewrite middleware in app.ts (lines 78-83) provides client-facing versioning, but the actual route definitions in index.ts don't use versioned paths. This means there's no clear mechanism for running v1 and v2 side-by-side if breaking changes are needed later.

**Risk:** Very low for current stage. The rewrite approach works well for now and can be refactored later if needed.

**Fix (future):** When a v2 is needed, create `routes/v2/index.ts` and mount both versions explicitly rather than rewriting URLs.

---

#### L2. Scheduler `retryCount` Incremented Before Claim Check

**File:** `artifacts/api-server/src/services/publish-scheduler.ts` (line 77)

**Problem:** `newRetryCount` is calculated at line 77 (inside the claim transaction), but the transaction might return `null` if the entry is already being processed (line 72-74). In that case, the retry count increment is discarded (correct behavior). However, if the claim succeeds but the actual publish call fails, the retry count was calculated before we know the outcome. This is technically fine since the value is only written to the DB in the final result transaction (lines 227), but it makes the code harder to reason about.

**Fix (clarity only):** Move `newRetryCount` calculation to after the claim check, closer to where it's used:
```typescript
if (!claimed) return;
const { entry, socialAccount, variant } = claimed;
const newRetryCount = (entry.retryCount || 0) + 1;
```

---

## Summary

| Severity | Count | Notes |
|----------|-------|-------|
| **CRITICAL** | 0 | None |
| **HIGH** | 0 | None |
| **MEDIUM** | 2 | Pagination and CORS defense-in-depth |
| **LOW** | 2 | Code clarity items |
| **TOTAL** | **4** | |

---

## Issue Resolution Across All Audits

| Audit | Issues Found | Issues Resolved | Running Total |
|-------|-------------|-----------------|---------------|
| V1 (Initial) | 38 | — | 38 |
| V2 (Post Tasks #21-24) | 27 | 19 fixed from V1 | 27 |
| V3 (Post Tasks #26-28) | 10 | 20 fixed from V2 | 10 |
| V4 (Current) | 4 | 9 fixed from V3 | **4** |

**38 → 4 issues across four audit cycles. Zero Critical or High severity remaining.**

---

## Verdict: Approaching Production-Ready

The SparqMake codebase has reached a mature state. The security posture is solid (CORS allowlist, CSRF, rate limiting, SSRF protection, token encryption, production guards). The data layer has proper foreign keys, transactions, and advisory locks. The AI pipeline is configurable and resilient. The publishing services handle all major platforms with proper error classification.

The 4 remaining items are all enhancements — none block functionality. The app is ready for:
1. End-to-end functional testing of all platform publish flows
2. TikTok backend implementation (see `TIKTOK_PHASE5_PROMPT.md`)
3. Production deployment preparation

---

*Generated by codebase audit V4 on March 23, 2026. Final version — supersedes V1, V2, V3.*
*Excludes TikTok/YouTube gaps (see TIKTOK_PHASE5_PROMPT.md).*
