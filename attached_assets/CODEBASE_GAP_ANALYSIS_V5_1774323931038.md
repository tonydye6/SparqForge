# SparqMake™ — Codebase Gap Analysis V5

**Date:** March 23, 2026
**Scope:** Full re-audit after Phase 1 implementation (~9,700 lines added, 68 files changed)
**Purpose:** Identify every remaining issue. Supersedes V1–V4.
**Exclusions:** TikTok and YouTube integration.

---

## What Changed Since V4

Massive feature drop — 50+ new commits adding:
- **Setup Wizard** — 9-step guided onboarding flow (brand → voice → logo → font → assets → template → platform rules → readiness check)
- **Layout Editor** — Visual template layout editor with gradient, headline zone, logo placement controls + live preview
- **Review Queue Overhaul** — Bulk approve/reject, platform preview frames, categorized reject reasons, side-by-side comparison
- **Campaign Studio Decomposition** — Refactored from 1,600-line monolith into 10+ focused components
- **Pre-Generation Gates** — Brand readiness validation + asset approval checks before generation starts
- **Pagination** — Added to all list endpoints
- **Zod Validation Middleware** — Server-side request validation on settings, rewrite, download routes
- **Batch Scheduling** — Bulk calendar entry creation from campaign variants
- **Empty States** — Meaningful empty states on all pages
- **Unsaved Changes Warning** — Form dirty detection in Settings

### V4 Issues Resolved

| V4 Issue | Status |
|----------|--------|
| M1: Content plan missing pagination | ✅ FIXED — All list endpoints now paginated |
| M2: CORS allows missing Origin | ✅ ACCEPTABLE — Documented, CSRF mitigates state-changing requests |
| L1: No side-by-side API versioning | ✅ FIXED — `/api/v1/` rewrite middleware added |
| L2: Scheduler retryCount clarity | ✅ ACCEPTABLE — Code is clear enough with current structure |

---

## Remaining Issues

### HIGH — Bugs That Will Cause Runtime Errors

#### H1. VariantCard Caption Length Crash

**File:** `artifacts/sparqmake/src/components/campaign-studio/VariantCard.tsx` (line 194)

**Problem:** Accesses `variant.caption.length` without null check. If a variant has no caption (null or undefined), this crashes the component:
```typescript
<span className="text-[10px] text-muted-foreground">{variant.caption.length} chars</span>
```

**Fix:**
```typescript
<span className="text-[10px] text-muted-foreground">{variant.caption?.length || 0} chars</span>
```

---

#### H2. onRefineSubmit Handler Is Empty (Lost Feature)

**File:** `artifacts/sparqmake/src/pages/CampaignStudio.tsx` (line 1157)

**Problem:** During the decomposition refactor, the "refine all variants" functionality was lost. The handler is wired up as an empty function:
```typescript
onRefineSubmit={() => {}}
```
The VariantGrid component renders a search bar with a submit button (VariantGrid.tsx lines 79-89) that does nothing when clicked.

**Fix:** Implement the bulk refinement handler that sends a refinement prompt to all variants, or remove the UI element until it's implemented.

---

#### H3. Upload Race Condition in Setup Wizard

**Files:**
- `artifacts/sparqmake/src/components/setup/StepUploadFont.tsx` (~lines 69-100)
- `artifacts/sparqmake/src/components/setup/StepUploadAsset.tsx` (~lines 50-104)

**Problem:** Multi-file uploads run serially in a loop. If one upload fails mid-loop, `setUploading(false)` fires after ALL attempts complete, but remaining uploads still execute after the error. The user sees a generic error but files after the failure may or may not have uploaded.

**Fix:** Add an abort flag or use `Promise.allSettled` for parallel uploads with per-file status:
```typescript
const results = await Promise.allSettled(
  files.map(file => uploadFile(file))
);
const failures = results.filter(r => r.status === 'rejected');
if (failures.length > 0) {
  toast.error(`${failures.length} of ${files.length} uploads failed`);
}
```

---

#### H4. Bulk Variant Update Missing reviewerComment Length Limit

**File:** `artifacts/api-server/src/routes/campaign-variants.ts` (~line 143)

**Problem:** The Zod schema for bulk update validates `variantIds` and `status` but `reviewerComment` has no `.max()` constraint:
```typescript
reviewerComment: z.string().optional(),
```
An attacker could send a multi-megabyte comment string, causing database bloat and slow responses.

**Fix:**
```typescript
reviewerComment: z.string().max(5000).optional(),
```

---

#### H5. Calendar Entries Batch Scheduling Missing Pagination/Limit

**File:** `artifacts/api-server/src/routes/calendar-entries.ts`

**Problem:** The GET endpoint for calendar entries accepts `start` and `end` date filters but no `limit` parameter. A query with a wide date range (or no dates) returns all entries, which could be thousands of rows.

**Fix:** Add a `limit` parameter with a default of 200 and a maximum of 1000.

---

#### H6. CSV Import Does N+1 Inserts

**File:** `artifacts/api-server/src/routes/content-plan.ts` (~lines 260-290)

**Problem:** Each CSV row is inserted individually in a loop. A 1,000-row CSV import makes 1,000 separate INSERT queries. This is slow and not wrapped in a transaction (partial imports if one row fails).

**Fix:** Batch insert all rows in a single transaction:
```typescript
await db.transaction(async (tx) => {
  const values = rows.map(row => ({
    title: row.title,
    primaryPlatform: row.platform,
    // ... other fields
  }));
  await tx.insert(socialContentPlanItemsTable).values(values).returning();
});
```

---

### MEDIUM — Correctness and UX Issues

#### M1. SetupWizard stepStatuses May Reference Stale Data

**File:** `artifacts/sparqmake/src/hooks/useSetupWizard.ts` (~line 80)

**Problem:** `stepStatuses` is computed from `brandReadiness` query data, but when `readinessLoading` is true, the computed statuses may be stale. The `findIndex()` for the first incomplete step could navigate to the wrong step during loading.

**Fix:** Skip auto-navigation while `readinessLoading` is true:
```typescript
const firstIncomplete = readinessLoading ? currentStep : stepStatuses.findIndex(s => !s.complete);
```

---

#### M2. LayoutSpecEditor JSON.stringify Comparison Risk

**File:** `artifacts/sparqmake/src/components/layout-editor/LayoutSpecEditor.tsx` (~lines 105-110)

**Problem:** Uses `JSON.stringify()` to detect external value changes. Floating-point values like gradient opacity (0.05 increments) may serialize differently on different updates (e.g., `0.30000000000000004` vs `0.3`), causing unnecessary re-renders or infinite update loops.

**Fix:** Use a deep equality check library (like `lodash.isEqual`) instead of JSON serialization:
```typescript
import isEqual from "lodash/isEqual";
if (!isEqual(value, localSpec)) setLocalSpec(value);
```

---

#### M3. RejectReasonDialog Weak Comment Validation

**File:** `artifacts/sparqmake/src/components/review/RejectReasonDialog.tsx` (~line 42)

**Problem:** Validates `comment.length < 10` but doesn't trim whitespace. A comment of 10+ spaces passes validation.

**Fix:**
```typescript
const trimmed = comment.trim();
if (trimmed.length < 10) {
  toast.error("Please provide at least 10 characters of feedback");
  return;
}
```

---

#### M4. HeadlineZoneEditor Accepts Partial Hex Colors

**File:** `artifacts/sparqmake/src/components/layout-editor/HeadlineZoneEditor.tsx` (~lines 227-230)

**Problem:** Regex `/^#[0-9A-Fa-f]{0,6}$/` accepts incomplete hex values like `#1` or `#12`. These invalid colors render incorrectly in the preview.

**Fix:** Only commit the value on blur if it's a valid 3 or 6 digit hex:
```typescript
const isValidHex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value);
if (isValidHex) onChange(value);
```

---

#### M5. VariantComparisonView Missing Image Fallback

**File:** `artifacts/sparqmake/src/components/review/VariantComparisonView.tsx` (~line 96)

**Problem:** If both `compositedImageUrl` and `rawImageUrl` are null, renders an empty card with no visual feedback. User sees blank space.

**Fix:** Add a placeholder:
```typescript
{imageUrl ? (
  <img src={imageUrl} ... />
) : (
  <div className="flex items-center justify-center h-48 bg-muted rounded">
    <span className="text-muted-foreground text-sm">No image available</span>
  </div>
)}
```

---

#### M6. LayoutPreviewCanvas Silent Logo Load Failure

**File:** `artifacts/sparqmake/src/components/layout-editor/LayoutPreviewCanvas.tsx` (~line 249)

**Problem:** `onError={() => {}}` silently ignores logo image load failures. User sees "LOGO" placeholder text but doesn't know if their actual logo URL is broken.

**Fix:** Show a visual indicator that logo failed to load:
```typescript
const [logoError, setLogoError] = useState(false);
// ...
onError={() => setLogoError(true)}
// Then conditionally show warning icon or red border
```

---

#### M7. StepReadinessCheck Hardcoded Step Mapping

**File:** `artifacts/sparqmake/src/components/setup/StepReadinessCheck.tsx` (lines 18-25)

**Problem:** `READINESS_TO_STEP` maps readiness check names to wizard step indices with hardcoded numbers. If `WIZARD_STEPS` in setup-defaults.ts is reordered, this mapping breaks silently.

**Fix:** Derive the mapping from the WIZARD_STEPS array:
```typescript
const READINESS_TO_STEP = Object.fromEntries(
  WIZARD_STEPS.map((step, idx) => [step.readinessKey, idx]).filter(([k]) => k)
);
```

---

#### M8. Information Disclosure in Error Messages

**Files:** `calendar-entries.ts`, `campaign-variants.ts`, `content-plan.ts`

**Problem:** Error messages expose internal state like campaign IDs and status values:
```typescript
`Campaign ${entry.campaignId} is not approved (status: ${campaign.status})`
```

**Fix:** Return generic error messages without internal identifiers:
```typescript
"Campaign is not in a valid state for scheduling"
```

---

### LOW — Code Quality and Hardening

#### L1. Dynamic Imports in Hot Paths

**Files:** `content-plan.ts`, `generate.ts`, `assets.ts`

**Problem:** Uses `await import("drizzle-orm")` and similar dynamic imports inside request handlers instead of static imports at file top.

**Fix:** Move all imports to the top of the file.

---

#### L2. Unsafe `as any` Type Assertions Throughout Frontend

**Files:** CampaignStudio.tsx, ReviewQueue.tsx, Settings.tsx, VariantCard.tsx

**Problem:** Multiple `as any` and `as Record<string, unknown>` casts bypass TypeScript safety. If API response shapes change, these won't catch the mismatch at compile time.

**Fix:** Define proper interfaces for all API responses and use Zod for runtime validation.

---

#### L3. Missing Zod Validation on Most Routes

**Files:** Most route files in `artifacts/api-server/src/routes/`

**Problem:** The Zod `validateRequest` middleware was added to settings, rewrite, and download routes, but most other routes still do manual validation. The bulk update and batch schedule endpoints use inline Zod, but campaigns, brands, templates, assets, calendar-entries (non-batch), and generate routes don't.

**Fix:** Gradually apply `validateRequest` middleware to all routes for consistent validation.

---

#### L4. WizardStepShell Missing Focus Management

**File:** `artifacts/sparqmake/src/components/setup/WizardStepShell.tsx`

**Problem:** When navigating between wizard steps, keyboard focus stays on the previous step's button. Keyboard-only users must tab through the entire page to reach the new step content.

**Fix:** Add `useEffect` to focus the step content container on mount:
```typescript
const contentRef = useRef<HTMLDivElement>(null);
useEffect(() => { contentRef.current?.focus(); }, []);
```

---

#### L5. No Authorization Layer (Design Gap)

**All route files**

**Problem:** No routes check resource ownership. Any authenticated user can approve/reject any variant, delete any calendar entry, publish to any social account, or modify any brand. Currently acceptable for a single-user/small-team tool, but will need role-based access control if the user base grows.

**Fix (future):** Add ownership checks or RBAC middleware. For now, document this as a known limitation.

---

## Summary

| Severity | Count | Key Impact |
|----------|-------|------------|
| **CRITICAL** | 0 | None |
| **HIGH** | 6 | Runtime crash, lost feature, upload race condition, input validation |
| **MEDIUM** | 8 | UX issues, stale state, validation gaps, info disclosure |
| **LOW** | 5 | Code quality, type safety, accessibility |
| **TOTAL** | **19** | |

Note: Issue count increased from 4 (V4) to 19 because ~9,700 lines of new code were added. The ratio of issues to new code is healthy — roughly 1 issue per 500 lines of new code, and none are Critical.

---

## Recommended Fix Order

**Phase 1 — Runtime Fixes**
1. H1: Add null check for `variant.caption?.length`
2. H2: Implement `onRefineSubmit` or remove the UI element
3. H4: Add `.max(5000)` to reviewerComment in bulk update schema
4. M3: Add `.trim()` to reject reason comment validation

**Phase 2 — Data Integrity:**
5. H3: Fix upload race condition with `Promise.allSettled`
6. H5: Add limit to calendar entries query
7. H6: Batch CSV import inserts in transaction
8. M8: Sanitize error messages to remove internal IDs

**Phase 3 — UX Polish:**
9. M1: Guard wizard auto-navigation during loading
10. M2: Use deep equality instead of JSON.stringify
11. M4: Validate hex colors are complete before committing
12. M5: Add image fallback placeholder in comparison view
13. M6: Show visual indicator for logo load failures
14. M7: Derive readiness-to-step mapping from WIZARD_STEPS array

**Phase 4 — Quality (optional):**
15-19: L1 through L5

---

## Issue Resolution Across All Audits

| Audit | New Code | Issues Found | Issues Fixed | Running Total |
|-------|----------|-------------|--------------|---------------|
| V1 | — | 38 | — | 38 |
| V2 | Tasks #21-24 | 27 | 19 | 27 |
| V3 | Tasks #26-28 | 10 | 20 | 10 |
| V4 | Latest fixes | 4 | 9 | 4 |
| V5 | Phase 1 (~9.7k lines) | 19 | 4 | **19** |

**Cumulative: 52 unique issues fixed across V1→V4. 19 new issues from Phase 1 feature drop.**

---

*Generated by codebase audit V5 on March 23, 2026. Supersedes all prior versions.*
*Excludes TikTok/YouTube gaps (see TIKTOK_PHASE5_PROMPT.md).*
