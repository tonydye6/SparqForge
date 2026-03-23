# Phase 1: Brand Safety Gates + Input Validation + Quick Wins

**Date:** 2026-03-23
**Status:** Design
**Scope:** 16 issues from UX/UI audit

---

## Goals

1. Prevent unsafe generation (unapproved assets, unconfigured brands)
2. Standardize API input validation and pagination
3. Deliver 10 high-visibility quick wins that improve every screen

## Non-Goals

- Auth/role enforcement (deferred)
- CampaignStudio decomposition (Phase 3)
- Progressive loading (Phase 3)
- Setup wizard (Phase 2)
- Layout Spec visual editor (Phase 5)

---

## 1. Brand Safety Gates

### 1.1 Asset Picker Filters to Approved Only

**File:** `artifacts/sparqforge/src/pages/CampaignStudio.tsx`

The asset picker query in CampaignStudio must include `status=approved` as a non-removable filter. Users should not see unapproved or archived assets when selecting for campaigns.

**Change:** Where assets are fetched for the picker, add `status: "approved"` to the query parameters. Do not expose a status filter toggle in the Campaign Studio asset picker (the Asset Library page retains full status filtering).

### 1.2 Server-Side Asset Approval Validation

**File:** `artifacts/api-server/src/routes/generate.ts`

**CRITICAL ordering constraint:** `generate.ts` calls `res.writeHead(200, { "Content-Type": "text/event-stream" })` early in the handler (around line 172). Once SSE headers are sent, it is impossible to return a 400 response. Both the asset approval check (1.2) and brand readiness check (1.3) MUST run BEFORE `res.writeHead` is called. Place them immediately after extracting the campaign and its `selectedAssets`, before any SSE setup.

Before generation begins, validate that every asset ID in `selectedAssets` has `status=approved` in the database. If any asset is not approved, return 400 (before SSE headers) with:

```json
{
  "error": "UNAPPROVED_ASSETS",
  "message": "All selected assets must be approved before generation",
  "unapprovedAssets": ["asset-id-1", "asset-id-2"]
}
```

### 1.3 Brand Readiness Validation

**Files:**
- New: `artifacts/api-server/src/lib/brand-readiness.ts`
- New: `artifacts/sparqforge/src/hooks/useBrandReadiness.ts`
- Modified: `artifacts/api-server/src/routes/generate.ts`
- New: `artifacts/api-server/src/routes/brand-readiness.ts`

**Shared readiness check** (`import { checkBrandReadiness } from "../lib/brand-readiness.js"` in generate.ts) evaluates a brand against these requirements:

| Requirement | Field Check | Required? |
|---|---|---|
| Logo uploaded | `brand.logoFileUrl` is non-null and non-empty string | Yes |
| At least one font | `Array.isArray(brand.brandFonts) && brand.brandFonts.length >= 1` (null-safe — `brandFonts` column can be null for brands that have never had fonts added) | Yes |
| Voice description set | `brand.voiceDescription` is non-empty string | Yes |
| Platform rules configured | `typeof brand.platformRules === 'object' && brand.platformRules !== null && Object.keys(brand.platformRules).length >= 1` (schema defaults to `{}` which should FAIL this check) | Yes |
| At least one approved asset | Query assets table for `brandId` + `status=approved`, count >= 1 | Yes |
| At least one active template | Query templates table for `brandId` + `isActive=true`, count >= 1 | Yes |

**API endpoint:** `GET /api/brand-readiness/:brandId` returns:

```json
{
  "ready": false,
  "missing": ["logo", "fonts"],
  "checks": {
    "logo": { "passed": false, "label": "Brand logo uploaded" },
    "fonts": { "passed": false, "label": "At least one brand font" },
    "voice": { "passed": true, "label": "Voice description configured" },
    "platformRules": { "passed": true, "label": "Platform rules set" },
    "approvedAssets": { "passed": true, "label": "Approved assets available", "count": 12 },
    "templates": { "passed": true, "label": "Active template exists", "count": 3 }
  }
}
```

**Frontend hook:** `useBrandReadiness(brandId)` calls this endpoint and returns `{ ready, missing, checks, isLoading }`. The React Query hook should use `staleTime: 0` and `refetchOnWindowFocus: true` to ensure the Generate button reflects changes made in Settings without requiring a page reload. Additionally, the Settings page save handlers should call `queryClient.invalidateQueries({ queryKey: ['brand-readiness', brandId] })` on successful save.

Used by:
- CampaignStudio: disables Generate button when `!ready`
- Settings: displays readiness indicator

**Server-side gate:** `generate.ts` calls `checkBrandReadiness(brandId)` BEFORE `res.writeHead(200, SSE headers)`. Returns 400 with the same shape if not ready. See ordering constraint in section 1.2.

---

## 2. Input Validation

### 2.1 Zod Validation Middleware

**File:** New: `artifacts/api-server/src/middleware/validate.ts`

A reusable Express middleware:

```typescript
function validateRequest(schema: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema })
```

Returns 400 with `{ error: "VALIDATION_ERROR", details: ZodError.issues }` on failure.

**Note on existing validation:** Several routes already have inline Zod validation via `safeParse` (brands POST/PUT, assets POST/PUT, campaigns POST/PUT, templates POST/PUT, hashtag-sets POST/PUT). Do NOT add the middleware to those routes — it would double-validate. The middleware should only be applied to routes that currently lack validation: `settings PUT`, `rewrite POST`, and `download` params.

### 2.2 Pagination on List Endpoints

**Files:** `routes/campaigns.ts`, `routes/assets.ts`, `routes/templates.ts`, `routes/hashtag-sets.ts`

Add consistent pagination to all GET list endpoints:

**Query params:** `limit` (default 50, max 200), `offset` (default 0)

**Response shape:**
```json
{
  "data": [...],
  "total": 147,
  "limit": 50,
  "offset": 0
}
```

**OpenAPI spec update required:** The response schemas in `lib/api-spec/openapi.yaml` must be updated to reflect the new paginated response shape for each affected endpoint. After updating the OpenAPI spec, run orval to regenerate the client code in `lib/api-client-react/src/generated/`. All frontend consumers (useGet* hooks) will then type-check against the new `{ data, total, limit, offset }` shape. Do NOT attempt to work around this via the custom-fetch layer — that has no per-endpoint knowledge and would silently produce type mismatches.

### 2.3 Remove Duplicate Assets Recommended Endpoint

**File:** `routes/assets.ts`

There are two `GET /assets/recommended` handlers (approximately lines 67 and 206) with different response shapes. In Express, only the first registered handler executes; the second at line 206 is currently unreachable.

**Action:** Remove the FIRST handler (line ~67), which is currently active and returns assets including `status=uploaded` (not just approved) with a `{ subjectReferences, styleReferences, contextCards }` response shape. Keep and promote the SECOND handler (line ~206), which returns only approved assets with per-asset scoring — this is the correct behavior for Campaign Studio.

**Breaking change:** The response shape changes from `{ subjectReferences, styleReferences, contextCards }` to a flat scored array. Any frontend consumers of the old response shape must be updated. Check CampaignStudio.tsx for usage of the recommended endpoint and update the destructuring/access pattern accordingly.

---

## 3. Quick Wins

### 3.1 Brand Readiness Indicator in Settings

**File:** `artifacts/sparqforge/src/pages/Settings.tsx`

At the top of each brand tab, render a `BrandReadinessCard` component using the `useBrandReadiness` hook. Shows a checklist of 6 items with green check / red X per item. If all pass, show a green "Ready for generation" badge. If any fail, show amber "Setup incomplete" with the missing items listed.

### 3.2 Variant Approval Progress Bar in Review Queue

**File:** `artifacts/sparqforge/src/pages/ReviewQueue.tsx`

In the expanded campaign detail view, above the variant grid, add a progress bar:

```
Variant Review: ███████░░░ 3 of 5 approved
```

Use the variant statuses to calculate: approved count / total count. Color: green when all approved, amber when in progress, red if any rejected.

### 3.3 Meaningful Empty States

**Files:** Modified: `artifacts/sparqforge/src/components/ui/empty-state.tsx` (convenience wrapper), all page components

**Note:** The codebase already has `artifacts/sparqforge/src/components/ui/empty.tsx` with composable primitives (`Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, etc.). Rather than creating a parallel system, create a thin convenience wrapper component that uses the existing primitives internally:

Create `empty-state.tsx` as a prop-based wrapper:

```typescript
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}
```

Apply to each page:

| Page | Icon | Title | Description | Action |
|---|---|---|---|---|
| CampaignStudio (no brand selected) | Sparkles | Start a campaign | Select a brand and template to begin | — |
| Asset Library (no assets) | ImagePlus | No assets yet | Upload brand assets to start building campaigns | Upload Assets |
| Calendar (no entries) | CalendarPlus | Calendar is empty | Schedule campaigns to see them here | Go to Campaign Studio |
| Review Queue (no items) | ClipboardCheck | Nothing to review | Campaigns submitted for review will appear here | — |
| Content Plan (no items) | FileSpreadsheet | No content planned | Import a CSV or create your first content plan item | Import CSV |
| Cost Dashboard (no data) | BarChart3 | No spending data | API costs will appear here after your first generation | — |

### 3.4 Calendar Drag-Drop Undo

**File:** `artifacts/sparqforge/src/pages/Calendar.tsx`

**Replace the existing pre-commit confirm pattern.** The current code uses a `pendingReschedule` state and a "Reschedule?" confirmation toast (lines ~295-311). Replace this with a post-commit undo pattern:

1. Remove the `pendingReschedule` state and the "Reschedule?" confirm toast entirely
2. On drop: immediately commit the PUT call to update `scheduledAt`
3. Store `{ entryId, previousScheduledAt }` in a ref before the PUT
4. Show toast with "Rescheduled to [date]. Undo?" with an Undo action button (15-second duration)
5. If Undo clicked: PUT the entry back to `previousScheduledAt`, update local state, show "Reverted" toast
6. If toast dismissed without undo: no action needed (already committed)

### 3.5 Inline Cost Estimate in CampaignStudio

**File:** `artifacts/sparqforge/src/pages/CampaignStudio.tsx`

In the right panel (action buttons area), add a small cost display below the action buttons:

```
Est. cost: $0.42
Daily: $3.18 / $10.00
```

Fetch from the existing `/api/settings/daily-budget-status` endpoint. Show amber text if `nearLimit`, red if `overBudget`. Update after each generation completes.

### 3.6 Save as Hashtag Set from Caption

**File:** `artifacts/sparqforge/src/pages/CampaignStudio.tsx`

Below the hashtags in each variant card's caption area, add a "Save as Hashtag Set" link. On click:

1. Extract all `#hashtag` tokens from the caption text
2. Open a small popover/dialog with: pre-filled hashtags (editable), name input, brand pre-selected
3. POST to `/api/hashtag-sets` on save
4. Show success toast

### 3.7 Pre-Generation Validation UI

**File:** `artifacts/sparqforge/src/pages/CampaignStudio.tsx`

The Generate button behavior:

- If no brand selected: disabled, tooltip "Select a brand"
- If brand not ready (`useBrandReadiness`): disabled, tooltip "Brand setup incomplete: missing [logo, fonts]"
- If no template selected: disabled, tooltip "Select a template"
- If no assets selected: disabled, tooltip "Select at least one asset"
- If all prerequisites met: enabled, primary blue

Use `TooltipProvider` + `Tooltip` from existing UI components wrapping the button.

### 3.8 Settings Section Navigation

**File:** `artifacts/sparqforge/src/pages/Settings.tsx`

Add a sticky left-hand section nav within the Settings content area (not replacing the main sidebar). Sections:

1. Brand Readiness (new)
2. Brand DNA
3. Imagen Config
4. Platform Rules
5. Templates
6. Font Management
7. Connected Accounts

Each item scrolls to its section via `scrollIntoView({ behavior: 'smooth' })`. Active section highlighted based on scroll position via `IntersectionObserver`.

### 3.9 Unsaved Changes Warning in Settings

**File:** `artifacts/sparqforge/src/pages/Settings.tsx`

Track form dirty state per section. When any section has unsaved changes:

1. Show an amber banner at the top: "You have unsaved changes in [section name]"
2. Add `beforeunload` event listener to warn on page navigation
3. Clear dirty state on successful save

Implementation: a `useFormDirty(initialValues, currentValues)` hook that uses deep-equality comparison (e.g., a recursive comparator or structuredClone-based comparison), NOT `JSON.stringify`. JSON.stringify is key-order-sensitive — if the server returns `{ instagram: {...}, twitter: {...} }` but the form rebuilds as `{ twitter: {...}, instagram: {...} }`, stringify falsely reports dirty state on every page load.

### 3.10 Pending Asset Badge in Sidebar

**File:** `artifacts/sparqforge/src/components/layout/Sidebar.tsx`

Add a badge to the "Asset Library" nav item showing the count of assets with `status=uploaded` (pending approval).

**Approach:** Use the existing `/api/assets?status=uploaded` endpoint with `limit=1` (once pagination from item 2.2 is implemented). Read the `total` field from the paginated response to get the count without transferring full asset records. This avoids creating a new endpoint.

**Dependency:** This item depends on pagination (2.2) being implemented first, since the current endpoint returns a bare array with no `total` field. Implement after 2.2.

Use the same badge style as the existing Review Queue badge.

---

## New Files Summary

| File | Purpose |
|---|---|
| `api-server/src/lib/brand-readiness.ts` | Shared brand readiness check function |
| `api-server/src/routes/brand-readiness.ts` | GET /api/brand-readiness/:brandId endpoint |
| `api-server/src/middleware/validate.ts` | Zod validation middleware |
| `sparqforge/src/hooks/useBrandReadiness.ts` | Frontend hook for brand readiness |
| `sparqforge/src/components/ui/empty-state.tsx` | Shared empty state component |

## Modified Files Summary

| File | Changes |
|---|---|
| `api-server/src/routes/generate.ts` | Add asset approval check + brand readiness check BEFORE `res.writeHead` |
| `api-server/src/routes/assets.ts` | Add pagination, remove first duplicate recommended endpoint, update response shape |
| `api-server/src/routes/campaigns.ts` | Add pagination |
| `api-server/src/routes/templates.ts` | Add pagination |
| `api-server/src/routes/hashtag-sets.ts` | Add pagination |
| `api-server/src/routes/settings.ts` | Add Zod validation to PUT |
| `api-server/src/routes/rewrite.ts` | Add Zod validation to POST |
| `api-server/src/routes/index.ts` | Register brand-readiness routes (NOT app.ts — all routes are registered here) |
| `lib/api-spec/openapi.yaml` | Update response schemas for paginated endpoints, regenerate client |
| `lib/api-client-react/src/generated/api.ts` | Regenerated by orval after OpenAPI spec update |
| `sparqforge/src/pages/CampaignStudio.tsx` | Approved-only assets, pre-gen validation, cost display, save hashtag set |
| `sparqforge/src/pages/ReviewQueue.tsx` | Variant progress bar, empty state |
| `sparqforge/src/pages/Settings.tsx` | Readiness card, section nav, unsaved changes, invalidate brand-readiness on save |
| `sparqforge/src/pages/AssetLibrary.tsx` | Empty states |
| `sparqforge/src/pages/Calendar.tsx` | Replace confirm toast with undo pattern, empty state |
| `sparqforge/src/pages/ContentPlan.tsx` | Empty state |
| `sparqforge/src/pages/CostDashboard.tsx` | Empty state |
| `sparqforge/src/components/layout/Sidebar.tsx` | Pending asset badge |

---

## Suggested Implementation Order

Items have dependencies that require a specific sequence:

**Group 1 — Backend foundations (no frontend dependencies):**
1. **2.3** Remove duplicate assets/recommended endpoint
2. **2.1** Zod validation middleware + apply to settings/rewrite/download
3. **1.3 server** Brand readiness check function (`lib/brand-readiness.ts` + route)
4. **1.2 server** Asset approval validation in generate.ts (+ 1.3 server gate, both before `writeHead`)

**Group 2 — Pagination (changes API contracts):**
5. **2.2** Add pagination to all list endpoints + update OpenAPI spec + regenerate orval client

**Group 3 — Frontend foundations (depend on Groups 1-2):**
6. **1.3 frontend** `useBrandReadiness` hook
7. **3.3** EmptyState convenience wrapper component

**Group 4 — CampaignStudio changes (depend on Group 3):**
8. **1.1** Approved-only asset filter
9. **3.7** Pre-generation validation UI (depends on useBrandReadiness)
10. **3.5** Inline cost estimate
11. **3.6** Save as Hashtag Set

**Group 5 — Settings changes (depend on Group 3):**
12. **3.1** Brand readiness indicator card (depends on useBrandReadiness)
13. **3.8** Section navigation
14. **3.9** Unsaved changes warning

**Group 6 — Remaining quick wins (depend on Groups 2-3):**
15. **3.2** Variant approval progress bar in Review Queue
16. **3.4** Calendar undo reschedule
17. **3.10** Pending asset badge in Sidebar (depends on pagination for `total` field)
18. Apply empty states to all remaining pages (Calendar, ContentPlan, CostDashboard, AssetLibrary)

Groups 4, 5, and 6 can be parallelized once Groups 1-3 are complete.

---

## Testing Strategy

Each change should be verifiable by:

1. **Brand safety gates:** Try to generate with an unapproved asset (should get 400). Try to generate with a brand missing logo (should get 400 with missing items). Verify Campaign Studio asset picker only shows approved assets.
2. **Validation:** Send malformed requests to validated endpoints (should get 400 with details). Test pagination with limit/offset params.
3. **Quick wins:** Visual verification — each empty state, badge, progress bar, tooltip, and section nav should be visible in the expected context.
