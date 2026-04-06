# Phase 1: Brand Safety Gates + Input Validation + Quick Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsafe generation, standardize API validation, and deliver 10 high-visibility UX quick wins across every screen.

**Architecture:** Server-side brand readiness checks gate generation. Pagination wraps all list endpoints. Frontend hooks consume readiness state to disable UI and show progress. EmptyState, badges, and progress bars fill every blank screen.

**Tech Stack:** Express + Drizzle ORM (backend), React + React Query + wouter (frontend), Zod (validation), orval (API client generation), shadcn/ui + Tailwind (components)

**Spec:** `docs/superpowers/specs/2026-03-23-phase1-brand-safety-validation-quick-wins-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `artifacts/api-server/src/lib/brand-readiness.ts` | Pure function: check brand readiness against 6 criteria |
| `artifacts/api-server/src/routes/brand-readiness.ts` | Express route: GET /api/brand-readiness/:brandId |
| `artifacts/api-server/src/middleware/validate.ts` | Reusable Zod validation middleware for Express |
| `artifacts/sparqmake/src/hooks/useBrandReadiness.ts` | React Query hook wrapping brand-readiness API |
| `artifacts/sparqmake/src/hooks/useFormDirty.ts` | Deep-equality dirty state tracker for forms |
| `artifacts/sparqmake/src/components/ui/empty-state.tsx` | Convenience wrapper over existing `empty.tsx` primitives |

### Modified Files

| File | Changes |
|---|---|
| `artifacts/api-server/src/routes/assets.ts` | Remove first recommended handler (line 67-126), add pagination to GET /assets |
| `artifacts/api-server/src/routes/generate.ts` | Add asset approval + brand readiness checks BEFORE writeHead (line 172) |
| `artifacts/api-server/src/routes/settings.ts` | Add Zod validation to PUT /settings |
| `artifacts/api-server/src/routes/rewrite.ts` | Replace manual validation with Zod middleware |
| `artifacts/api-server/src/routes/campaigns.ts` | Add pagination to GET /campaigns |
| `artifacts/api-server/src/routes/templates.ts` | Add pagination to GET /templates |
| `artifacts/api-server/src/routes/hashtag-sets.ts` | Add pagination to GET /hashtag-sets |
| `artifacts/api-server/src/routes/index.ts` | Register brandReadinessRouter |
| `lib/api-spec/openapi.yaml` | Add paginated response schemas, brand-readiness endpoint |
| `artifacts/sparqmake/src/pages/CampaignStudio.tsx` | Pre-gen validation tooltip, cost display, hashtag save |
| `artifacts/sparqmake/src/pages/Settings.tsx` | Readiness card, section nav, unsaved changes warning |
| `artifacts/sparqmake/src/pages/ReviewQueue.tsx` | Variant progress bar, empty state |
| `artifacts/sparqmake/src/pages/Calendar.tsx` | Replace confirm with undo pattern, empty state |
| `artifacts/sparqmake/src/pages/AssetLibrary.tsx` | Empty state |
| `artifacts/sparqmake/src/pages/ContentPlan.tsx` | Empty state |
| `artifacts/sparqmake/src/pages/CostDashboard.tsx` | Empty state |
| `artifacts/sparqmake/src/components/layout/Sidebar.tsx` | Pending asset badge |

---

## Task 1: Remove Duplicate Assets Recommended Endpoint

**Files:**
- Modify: `artifacts/api-server/src/routes/assets.ts:67-126` (delete first handler)

**Context:** There are two `GET /assets/recommended` handlers. Express only executes the first (line 67). The second (line 206) returns only approved assets with per-asset scoring — the correct behavior. We remove the first and promote the second.

- [ ] **Step 1: Delete the first recommended handler**

In `artifacts/api-server/src/routes/assets.ts`, remove lines 67-126 (the entire first `router.get("/assets/recommended", ...)` block). The second handler at what was line 206 becomes the active one. It already filters `status === "approved"` only.

- [ ] **Step 2: Verify the surviving handler**

Read the file to confirm only one `router.get("/assets/recommended", ...)` exists and it includes `conditions.push(eq(assetsTable.status, "approved"))`.

- [ ] **Step 3: Check CampaignStudio for recommended endpoint usage**

Search `CampaignStudio.tsx` for any reference to `subjectReferences`, `styleReferences`, or `contextCards` (the old response shape). If found, these destructuring patterns must be updated to work with the new flat scored array shape.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/assets.ts
git commit -m "fix: remove duplicate assets/recommended endpoint, keep approved-only scored handler"
```

---

## Task 2: Zod Validation Middleware

**Files:**
- Create: `artifacts/api-server/src/middleware/validate.ts`
- Modify: `artifacts/api-server/src/routes/settings.ts`
- Modify: `artifacts/api-server/src/routes/rewrite.ts`

**Context:** Settings PUT and rewrite POST lack input validation. Other routes already have inline Zod safeParse — do NOT add middleware to those.

- [ ] **Step 1: Create validate.ts middleware**

Create `artifacts/api-server/src/middleware/validate.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";
import { type ZodSchema, type ZodError } from "zod";

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validateRequest(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ location: string; issues: ZodError["issues"] }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) errors.push({ location: "body", issues: result.error.issues });
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) errors.push({ location: "query", issues: result.error.issues });
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) errors.push({ location: "params", issues: result.error.issues });
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        details: errors.flatMap(e =>
          e.issues.map(i => ({ ...i, location: e.location }))
        ),
      });
      return;
    }

    next();
  };
}
```

- [ ] **Step 2: Apply to settings PUT**

In `artifacts/api-server/src/routes/settings.ts`, add the middleware import and a Zod schema for the settings body. The body must be a `Record<string, string>`:

Add at top:
```typescript
import { validateRequest } from "../middleware/validate.js";
import { z } from "zod";

const UpdateSettingsBody = z.record(z.string(), z.string());
```

Change line 16 from:
```typescript
router.put("/settings", async (req, res): Promise<void> => {
```
to:
```typescript
router.put("/settings", validateRequest({ body: UpdateSettingsBody }), async (req, res): Promise<void> => {
```

Remove the manual validation at lines 17-21 (the `if (!updates || typeof updates !== "object")` block) since the middleware now handles it.

- [ ] **Step 3: Apply to rewrite POST**

In `artifacts/api-server/src/routes/rewrite.ts`, add:

```typescript
import { validateRequest } from "../middleware/validate.js";
import { z } from "zod";

const RewriteBody = z.object({
  text: z.string().min(1).max(5000),
  instruction: z.string().min(1).max(500),
});
```

Change the route to:
```typescript
router.post("/rewrite", validateRequest({ body: RewriteBody }), async (req: Request, res: Response): Promise<void> => {
```

Remove the manual validation at lines 10-23 (the three `if` blocks checking text/instruction) since the Zod schema enforces all those constraints.

- [ ] **Step 4: Apply to download params (spec-required)**

In `artifacts/api-server/src/routes/download.ts`, add UUID validation to the `:id` param:

```typescript
import { validateRequest } from "../middleware/validate.js";
import { z } from "zod";

const DownloadParams = z.object({ id: z.string().uuid() });
```

Apply to the download route:
```typescript
router.get("/download/:id", validateRequest({ params: DownloadParams }), async (req, res) => {
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/middleware/validate.ts artifacts/api-server/src/routes/settings.ts artifacts/api-server/src/routes/rewrite.ts artifacts/api-server/src/routes/download.ts
git commit -m "feat: add Zod validation middleware, apply to settings, rewrite, and download routes"
```

---

## Task 3: Brand Readiness Check Function + API Route

**Files:**
- Create: `artifacts/api-server/src/lib/brand-readiness.ts`
- Create: `artifacts/api-server/src/routes/brand-readiness.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create brand-readiness.ts library**

Create `artifacts/api-server/src/lib/brand-readiness.ts`:

```typescript
import { eq, and, sql } from "drizzle-orm";
import { db, brandsTable, assetsTable, templatesTable } from "@workspace/db";

interface ReadinessCheck {
  passed: boolean;
  label: string;
  count?: number;
}

export interface BrandReadinessResult {
  ready: boolean;
  missing: string[];
  checks: Record<string, ReadinessCheck>;
}

export async function checkBrandReadiness(brandId: string): Promise<BrandReadinessResult> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));

  if (!brand) {
    return {
      ready: false,
      missing: ["brand"],
      checks: {
        brand: { passed: false, label: "Brand exists" },
      },
    };
  }

  const logoCheck = !!brand.logoFileUrl && brand.logoFileUrl.trim().length > 0;
  const fontsCheck = Array.isArray(brand.brandFonts) && brand.brandFonts.length >= 1;
  const voiceCheck = !!brand.voiceDescription && brand.voiceDescription.trim().length > 0;
  const platformRulesCheck =
    typeof brand.platformRules === "object" &&
    brand.platformRules !== null &&
    Object.keys(brand.platformRules).length >= 1;

  const [approvedAssetResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brandId), eq(assetsTable.status, "approved")));
  const approvedAssetCount = approvedAssetResult?.count ?? 0;

  const [activeTemplateResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(templatesTable)
    .where(and(eq(templatesTable.brandId, brandId), eq(templatesTable.isActive, true)));
  const activeTemplateCount = activeTemplateResult?.count ?? 0;

  const checks: Record<string, ReadinessCheck> = {
    logo: { passed: logoCheck, label: "Brand logo uploaded" },
    fonts: { passed: fontsCheck, label: "At least one brand font" },
    voice: { passed: voiceCheck, label: "Voice description configured" },
    platformRules: { passed: platformRulesCheck, label: "Platform rules set" },
    approvedAssets: { passed: approvedAssetCount >= 1, label: "Approved assets available", count: approvedAssetCount },
    templates: { passed: activeTemplateCount >= 1, label: "Active template exists", count: activeTemplateCount },
  };

  const missing = Object.entries(checks)
    .filter(([, check]) => !check.passed)
    .map(([key]) => key);

  return {
    ready: missing.length === 0,
    missing,
    checks,
  };
}
```

- [ ] **Step 2: Create brand-readiness route**

Create `artifacts/api-server/src/routes/brand-readiness.ts`:

```typescript
import { Router, type IRouter } from "express";
import { checkBrandReadiness } from "../lib/brand-readiness.js"; // .js extension matches generate.ts convention

const router: IRouter = Router();

router.get("/brand-readiness/:brandId", async (req, res): Promise<void> => {
  const { brandId } = req.params;

  if (!brandId) {
    res.status(400).json({ error: "brandId is required" });
    return;
  }

  const result = await checkBrandReadiness(brandId);
  res.json(result);
});

export default router;
```

- [ ] **Step 3: Register route in index.ts**

In `artifacts/api-server/src/routes/index.ts`, add:

After the other imports (around line 18). Note: existing imports in this file omit `.js` extensions — follow the same convention:
```typescript
import brandReadinessRouter from "./brand-readiness";
```

After the other `router.use(...)` calls (around line 38):
```typescript
router.use(brandReadinessRouter);
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/brand-readiness.ts artifacts/api-server/src/routes/brand-readiness.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add brand readiness check function and API endpoint"
```

---

## Task 4: Server-Side Generation Safety Gates

**Files:**
- Modify: `artifacts/api-server/src/routes/generate.ts:113-172`

**Context:** CRITICAL — both checks must go BEFORE `res.writeHead(200, ...)` at line 172. Once SSE headers are sent, 400 responses are impossible.

- [ ] **Step 1: Add imports and asset approval validation**

In `artifacts/api-server/src/routes/generate.ts`:

**At the top of the file (line 2)**, update the drizzle-orm import:
```typescript
import { eq, and, inArray } from "drizzle-orm";
```

**At line 10** (after the other imports), add:
```typescript
import { checkBrandReadiness } from "../lib/brand-readiness.js";
```

**After the `if (!campaign.templateId)` block (after line 125)** and BEFORE the budget check, add:

```typescript
  // --- Brand safety gates (must run before SSE writeHead) ---
  const selectedAssets = (campaign.selectedAssets || []) as SelectedAssetRef[];
  const selectedAssetIds = selectedAssets.map(a => a.assetId);

  if (selectedAssetIds.length > 0) {
    const assets = await db.select({ id: assetsTable.id, status: assetsTable.status })
      .from(assetsTable)
      .where(inArray(assetsTable.id, selectedAssetIds));

    const unapproved = assets.filter(a => a.status !== "approved").map(a => a.id);
    const missing = selectedAssetIds.filter(id => !assets.find(a => a.id === id));

    if (unapproved.length > 0 || missing.length > 0) {
      res.status(400).json({
        error: "UNAPPROVED_ASSETS",
        message: "All selected assets must be approved before generation",
        unapprovedAssets: [...unapproved, ...missing],
      });
      return;
    }
  }

  const readiness = await checkBrandReadiness(campaign.brandId);
  if (!readiness.ready) {
    res.status(400).json({
      error: "BRAND_NOT_READY",
      message: "Brand setup is incomplete",
      ...readiness,
    });
    return;
  }
```

Also add `inArray` to the drizzle-orm import at line 2:
```typescript
import { eq, and, inArray } from "drizzle-orm";
```

- [ ] **Step 2: Remove duplicate selectedAssets extraction**

The existing code extracts `selectedAssets` at line ~195 (inside the SSE try block) typed as `SelectedAssetRef[]`, and `selectedAssetIds` at line ~196. Since our new code above already extracts both with the same type (`SelectedAssetRef[]`), delete both lines. The variables are already in scope from the earlier extraction.

- [ ] **Step 3: Verify ordering**

Read the file to confirm the checks appear BEFORE `res.writeHead(200, ...)` and AFTER the campaign lookup. The order should be:
1. Campaign lookup (line 116)
2. Template check (line 122)
3. Asset approval check (new)
4. Brand readiness check (new)
5. Budget check (line 127+)
6. `res.writeHead(200, SSE)` (line 172)

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/generate.ts
git commit -m "feat: add asset approval and brand readiness gates before SSE generation"
```

---

## Task 5: Pagination on List Endpoints

**Files:**
- Modify: `artifacts/api-server/src/routes/assets.ts` (GET /assets)
- Modify: `artifacts/api-server/src/routes/campaigns.ts` (GET /campaigns)
- Modify: `artifacts/api-server/src/routes/templates.ts` (GET /templates)
- Modify: `artifacts/api-server/src/routes/hashtag-sets.ts` (GET /hashtag-sets)
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add pagination to GET /assets**

In `artifacts/api-server/src/routes/assets.ts`, modify the `router.get("/assets", ...)` handler (lines 19-65).

After building the `conditions` array and before executing the query, parse pagination params:

```typescript
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
```

Replace the query execution with:

```typescript
  const baseCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(baseCondition);
  const total = countResult?.count ?? 0;

  const results = baseCondition
    ? await db.select().from(assetsTable).where(baseCondition).orderBy(assetsTable.createdAt).limit(limit).offset(offset)
    : await db.select().from(assetsTable).orderBy(assetsTable.createdAt).limit(limit).offset(offset);

  res.json({ data: results, total, limit, offset });
```

Remove the `GetAssetsResponse.parse(results)` wrapper — it only validates the array, not the paginated shape.

- [ ] **Step 2: Add pagination to GET /campaigns**

Apply the same pattern to `artifacts/api-server/src/routes/campaigns.ts`. Find the GET /campaigns handler and add limit/offset parsing + count query + paginated response.

- [ ] **Step 3: Add pagination to GET /templates**

Apply the same pattern to `artifacts/api-server/src/routes/templates.ts`.

- [ ] **Step 4: Add pagination to GET /hashtag-sets**

Apply the same pattern to `artifacts/api-server/src/routes/hashtag-sets.ts`.

- [ ] **Step 5: Update OpenAPI spec**

In `lib/api-spec/openapi.yaml`, add a reusable paginated response component and update each GET list endpoint's response schema. Add under `components.schemas`:

```yaml
PaginatedResponse:
  type: object
  required: [data, total, limit, offset]
  properties:
    total:
      type: integer
    limit:
      type: integer
    offset:
      type: integer
```

Update each list endpoint to use `allOf` with `PaginatedResponse` plus a `data` array. Concrete example for GET /assets:

```yaml
paths:
  /api/assets:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/PaginatedResponse'
                  - type: object
                    properties:
                      data:
                        type: array
                        items:
                          $ref: '#/components/schemas/Asset'
```

Apply the same pattern for GET /campaigns (items: Campaign), GET /templates (items: Template), GET /hashtag-sets (items: HashtagSet).

Also add the `GET /brand-readiness/{brandId}` endpoint to the spec.

- [ ] **Step 6: Regenerate orval client**

```bash
cd /tmp/SparqMake && pnpm --filter @workspace/api-client-react run generate
```

This regenerates `lib/api-client-react/src/generated/api.ts` and `api.schemas.ts`. Verify the generated hooks now expect `{ data, total, limit, offset }` response shapes.

- [ ] **Step 7: Update frontend consumers**

After regeneration, all `useGetAssets`, `useGetCampaigns`, `useGetTemplates`, `useGetHashtagSets` calls throughout the frontend will need to access `.data` to get the array. Search for all usages and update:

- `const { data: assets } = useGetAssets(...)` → the `assets` object is now `{ data: Asset[], total, limit, offset }`, so anywhere iterating over assets needs `assets?.data` instead of `assets`.

Do this for each page: CampaignStudio, AssetLibrary, ReviewQueue, Settings, Calendar, ContentPlan.

**CRITICAL: Also fix Sidebar.tsx** — The `reviewCount` calculation at line 59 uses `campaigns?.filter(...)`. After pagination, `campaigns` is `{ data: Campaign[], total, ... }` not an array. Fix to:
```typescript
const reviewCount = campaigns?.data?.filter(c => c.status === "pending_review" || c.status === "in_review").length || 0;
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add pagination to all list endpoints, update OpenAPI spec and regenerate client"
```

---

## Task 6: useBrandReadiness Frontend Hook

**Files:**
- Create: `artifacts/sparqmake/src/hooks/useBrandReadiness.ts`

- [ ] **Step 1: Create the hook**

Create `artifacts/sparqmake/src/hooks/useBrandReadiness.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ReadinessCheck {
  passed: boolean;
  label: string;
  count?: number;
}

interface BrandReadinessResult {
  ready: boolean;
  missing: string[];
  checks: Record<string, ReadinessCheck>;
}

export function useBrandReadiness(brandId: string | null | undefined) {
  return useQuery<BrandReadinessResult>({
    queryKey: ["brand-readiness", brandId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/brand-readiness/${brandId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch brand readiness");
      return res.json();
    },
    enabled: !!brandId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/sparqmake/src/hooks/useBrandReadiness.ts
git commit -m "feat: add useBrandReadiness React Query hook"
```

---

## Task 7: EmptyState Convenience Wrapper

**Files:**
- Create: `artifacts/sparqmake/src/components/ui/empty-state.tsx`

- [ ] **Step 1: Create the wrapper component**

Create `artifacts/sparqmake/src/components/ui/empty-state.tsx`:

```typescript
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction && (
        <EmptyContent>
          <Button variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/sparqmake/src/components/ui/empty-state.tsx
git commit -m "feat: add EmptyState convenience wrapper over empty.tsx primitives"
```

---

## Task 8: CampaignStudio — Approved-Only Asset Filter

**Files:**
- Modify: `artifacts/sparqmake/src/pages/CampaignStudio.tsx:92`

**Context:** Line 92 already passes `status: "approved"` — verify this is enforced as a non-removable filter. The asset picker should not expose a status toggle.

- [ ] **Step 1: Verify existing filter**

Read `CampaignStudio.tsx` line 92. It already has:
```typescript
const { data: approvedAssets } = useGetAssets({ brandId: selectedBrand || undefined, status: "approved" }, { query: { enabled: !!selectedBrand } });
```

If this is already filtering to approved-only and there's no status toggle in the asset picker UI section, this task is already complete. Mark as done.

If there's a separate asset picker component or filter dropdown that exposes status toggles, remove it from the Campaign Studio context only.

- [ ] **Step 2: Commit if changes were needed**

```bash
git add artifacts/sparqmake/src/pages/CampaignStudio.tsx
git commit -m "fix: enforce approved-only asset filter in Campaign Studio"
```

---

## Task 9: Pre-Generation Validation UI

**Files:**
- Modify: `artifacts/sparqmake/src/pages/CampaignStudio.tsx`

- [ ] **Step 1: Import useBrandReadiness**

Add at the top of CampaignStudio.tsx:
```typescript
import { useBrandReadiness } from "@/hooks/useBrandReadiness";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
```

Inside the component, after the existing state declarations:
```typescript
const { data: brandReadiness } = useBrandReadiness(selectedBrand || null);
```

- [ ] **Step 2: Compute generation prerequisites**

Add a computed variable:
```typescript
const generateDisabledReason = (() => {
  if (!selectedBrand) return "Select a brand";
  if (brandReadiness && !brandReadiness.ready) {
    const missingLabels = brandReadiness.missing
      .map(key => brandReadiness.checks[key]?.label)
      .filter(Boolean)
      .join(", ");
    return `Brand setup incomplete: ${missingLabels}`;
  }
  if (!selectedTemplate) return "Select a template";
  if (selectedAssets.length === 0) return "Select at least one asset";
  return null;
})();
```

- [ ] **Step 3: Wrap Generate button with Tooltip**

Find the Generate button in the JSX. Replace:
```tsx
<Button onClick={handleGenerate} disabled={isGenerating || !selectedBrand || !selectedTemplate}>
  ...Generate
</Button>
```

With (note: `TooltipProvider` is required as a wrapper for shadcn/ui tooltips):
```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span>
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !!generateDisabledReason}
        >
          ...Generate
        </Button>
      </span>
    </TooltipTrigger>
    {generateDisabledReason && (
      <TooltipContent>{generateDisabledReason}</TooltipContent>
    )}
  </Tooltip>
</TooltipProvider>
```

Note: The `<span>` wrapper is needed because disabled buttons don't fire mouse events for tooltips. `TooltipProvider` must wrap `Tooltip` — check if a global one exists in `App.tsx` first; if so, this local wrapper is optional.

- [ ] **Step 4: Commit**

```bash
git add artifacts/sparqmake/src/pages/CampaignStudio.tsx
git commit -m "feat: add pre-generation validation with tooltip reasons on Generate button"
```

---

## Task 10: Inline Cost Estimate in CampaignStudio

**Files:**
- Modify: `artifacts/sparqmake/src/pages/CampaignStudio.tsx`

- [ ] **Step 1: Add budget status fetch**

Inside the component, add:
```typescript
const [budgetStatus, setBudgetStatus] = useState<{
  threshold: number | null;
  todaySpend: number;
  remaining: number | null;
  overBudget: boolean;
  nearLimit: boolean;
} | null>(null);

useEffect(() => {
  fetch(`${API_BASE}/api/settings/daily-budget-status`, { credentials: "include" })
    .then(r => r.json())
    .then(setBudgetStatus)
    .catch(() => {});
}, [generatedVariants.length]); // refetch after each generation
```

- [ ] **Step 2: Add cost display in the right panel**

Note: `estimatedCost` (line 105) is a state variable that gets populated from the SSE generation stream. Before any generation it is `0`. The display will show "$0.00" until a generation runs, which is the correct behavior — the budget status (daily spend / threshold) is the useful pre-generation information.

Find the right panel / action buttons area. Add below the Generate button:

```tsx
{budgetStatus && budgetStatus.threshold !== null && (
  <div className={cn(
    "text-xs mt-2 space-y-0.5",
    budgetStatus.overBudget ? "text-red-400" :
    budgetStatus.nearLimit ? "text-amber-400" : "text-muted-foreground"
  )}>
    <div>Est. cost: ${estimatedCost.toFixed(2)}</div>
    <div>Daily: ${budgetStatus.todaySpend.toFixed(2)} / ${budgetStatus.threshold.toFixed(2)}</div>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/sparqmake/src/pages/CampaignStudio.tsx
git commit -m "feat: show inline cost estimate and budget status in Campaign Studio"
```

---

## Task 11: Save as Hashtag Set from Caption

**Files:**
- Modify: `artifacts/sparqmake/src/pages/CampaignStudio.tsx`

**Context:** CampaignStudio already has `hashtagDialogOpen`, `hashtagSetName`, `hashtagsToSave`, and `savingHashtags` state (lines 115-118). There's already a dialog for this. Verify it works or wire it up if disconnected.

- [ ] **Step 1: Check existing hashtag save functionality**

Read lines 115-118 and search for `hashtagDialogOpen` usage in the JSX. If there's already a "Save as Hashtag Set" button in the variant cards and a corresponding dialog, verify it:
1. Extracts `#hashtag` tokens from caption
2. Pre-fills the dialog
3. POSTs to `/api/hashtag-sets`
4. Shows success toast

If all of this exists and works, mark this task as already implemented.

- [ ] **Step 2: If missing, add Save Hashtag Set link**

In each variant card's caption area, after the caption text, add:
```tsx
<button
  className="text-xs text-muted-foreground hover:text-foreground underline"
  onClick={() => {
    const tags = (variant.caption.match(/#\w+/g) || []).map(t => t.replace("#", ""));
    setHashtagsToSave(tags);
    setHashtagDialogOpen(true);
  }}
>
  Save as Hashtag Set
</button>
```

- [ ] **Step 3: Commit if changes made**

```bash
git add artifacts/sparqmake/src/pages/CampaignStudio.tsx
git commit -m "feat: add Save as Hashtag Set action from variant captions"
```

---

## Task 12: Brand Readiness Indicator in Settings

**Files:**
- Modify: `artifacts/sparqmake/src/pages/Settings.tsx`

- [ ] **Step 1: Import and use the hook**

Add at top of Settings.tsx:
```typescript
import { useBrandReadiness } from "@/hooks/useBrandReadiness";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";
```

Inside the component, where the selected brand state is managed, add:
```typescript
const { data: brandReadiness } = useBrandReadiness(activeBrandId || null);
```

Where `activeBrandId` is whatever state variable holds the current brand in Settings.

- [ ] **Step 2: Add BrandReadinessCard JSX**

At the top of the brand tab content (before Brand DNA section), render:

```tsx
{brandReadiness && (
  <div className={cn(
    "rounded-lg border p-4 mb-6",
    brandReadiness.ready ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5"
  )}>
    <div className="flex items-center gap-2 mb-3">
      {brandReadiness.ready ? (
        <><CheckCircle className="size-4 text-green-500" /><span className="text-sm font-medium text-green-500">Ready for generation</span></>
      ) : (
        <><AlertTriangle className="size-4 text-amber-500" /><span className="text-sm font-medium text-amber-500">Setup incomplete</span></>
      )}
    </div>
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(brandReadiness.checks).map(([key, check]) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          {check.passed ? (
            <CheckCircle className="size-3.5 text-green-500 shrink-0" />
          ) : (
            <XCircle className="size-3.5 text-red-500 shrink-0" />
          )}
          <span className={check.passed ? "text-muted-foreground" : "text-foreground"}>
            {check.label}
          </span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Invalidate readiness on save**

In each Settings save handler (brand DNA save, font save, platform rules save, etc.), add after the successful mutation:

```typescript
queryClient.invalidateQueries({ queryKey: ["brand-readiness", activeBrandId] });
```

The `queryClient` is already imported in Settings.tsx via `useQueryClient`.

- [ ] **Step 4: Commit**

```bash
git add artifacts/sparqmake/src/pages/Settings.tsx
git commit -m "feat: add brand readiness checklist card to Settings"
```

---

## Task 13: Settings Section Navigation

**Files:**
- Modify: `artifacts/sparqmake/src/pages/Settings.tsx`

- [ ] **Step 1: Add section IDs to each settings section**

Find each section heading in the Settings brand tab and add `id` attributes:

```tsx
<div id="section-readiness">...</div>
<div id="section-brand-dna">...</div>
<div id="section-imagen">...</div>
<div id="section-platform-rules">...</div>
<div id="section-templates">...</div>
<div id="section-fonts">...</div>
<div id="section-accounts">...</div>
```

- [ ] **Step 2: Add sticky section nav**

Add a left-hand section navigation within the content area. Wrap the Settings content in a flex layout:

```tsx
const SETTINGS_SECTIONS = [
  { id: "section-readiness", label: "Brand Readiness" },
  { id: "section-brand-dna", label: "Brand DNA" },
  { id: "section-imagen", label: "Imagen Config" },
  { id: "section-platform-rules", label: "Platform Rules" },
  { id: "section-templates", label: "Templates" },
  { id: "section-fonts", label: "Font Management" },
  { id: "section-accounts", label: "Connected Accounts" },
];

const [activeSection, setActiveSection] = useState("section-readiness");

useEffect(() => {
  const observers: IntersectionObserver[] = [];
  SETTINGS_SECTIONS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    observers.push(observer);
  });
  return () => observers.forEach(o => o.disconnect());
}, []);
```

Render the nav:
```tsx
<nav className="sticky top-4 w-48 shrink-0 hidden lg:block space-y-1">
  {SETTINGS_SECTIONS.map(({ id, label }) => (
    <button
      key={id}
      className={cn(
        "block w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors",
        activeSection === id
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:text-foreground"
      )}
      onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
    >
      {label}
    </button>
  ))}
</nav>
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/sparqmake/src/pages/Settings.tsx
git commit -m "feat: add sticky section navigation to Settings"
```

---

## Task 14: Unsaved Changes Warning in Settings

**Files:**
- Create: `artifacts/sparqmake/src/hooks/useFormDirty.ts`
- Modify: `artifacts/sparqmake/src/pages/Settings.tsx`

- [ ] **Step 1: Create useFormDirty hook**

Create `artifacts/sparqmake/src/hooks/useFormDirty.ts`:

```typescript
import { useMemo, useEffect } from "react";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    return [...keys].every(key => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

export function useFormDirty(initialValues: unknown, currentValues: unknown): boolean {
  const isDirty = useMemo(
    () => !deepEqual(initialValues, currentValues),
    [initialValues, currentValues]
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return isDirty;
}
```

- [ ] **Step 2: Apply to Settings sections**

In Settings.tsx, for each form section (Brand DNA, Imagen Config, Platform Rules, etc.), track the server-loaded values vs current form values:

```typescript
const isDirty = useFormDirty(serverBrandData, formBrandData);
```

At the top of the content area, show:
```tsx
{isDirty && (
  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 mb-4 text-sm text-amber-400">
    You have unsaved changes
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/sparqmake/src/hooks/useFormDirty.ts artifacts/sparqmake/src/pages/Settings.tsx
git commit -m "feat: add unsaved changes detection and warning in Settings"
```

---

## Task 15: Variant Approval Progress Bar in Review Queue

**Files:**
- Modify: `artifacts/sparqmake/src/pages/ReviewQueue.tsx`

- [ ] **Step 1: Add progress bar to expanded campaign view**

Find the expanded campaign detail section where variants are displayed. Add above the variant grid:

```tsx
{expandedCampaign?.variants && (
  (() => {
    const variants = expandedCampaign.variants;
    const total = variants.length;
    const approved = variants.filter((v: any) => v.status === "approved").length;
    const rejected = variants.filter((v: any) => v.status === "rejected").length;
    const pct = total > 0 ? (approved / total) * 100 : 0;

    return (
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="text-muted-foreground">Variant Review</span>
          <span className={cn(
            "font-medium",
            rejected > 0 ? "text-red-400" :
            approved === total ? "text-green-400" : "text-amber-400"
          )}>
            {approved} of {total} approved
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              rejected > 0 ? "bg-red-500" :
              approved === total ? "bg-green-500" : "bg-amber-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  })()
)}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/sparqmake/src/pages/ReviewQueue.tsx
git commit -m "feat: add variant approval progress bar to Review Queue"
```

---

## Task 16: Calendar Undo Reschedule

**Files:**
- Modify: `artifacts/sparqmake/src/pages/Calendar.tsx:271-311`

- [ ] **Step 1: Remove pendingReschedule state and confirm toast**

Remove:
1. The `pendingReschedule` state declaration (search for `useState` with `pendingReschedule`)
2. The `useEffect` block at lines 295-311 that shows the "Reschedule?" confirm toast
3. Any `setPendingReschedule(...)` calls in `handleDrop`

- [ ] **Step 2: Add undo ref and modify commitReschedule**

Add a ref:
```typescript
const lastRescheduleRef = useRef<{ entryId: string; previousScheduledAt: string } | null>(null);
```

Replace `commitReschedule` (lines 271-293) with:

```typescript
const commitReschedule = useCallback(async (entryId: string, newDate: Date) => {
  const entry = entries.find(e => e.id === entryId);
  const previousScheduledAt = entry?.scheduledAt || "";

  lastRescheduleRef.current = { entryId, previousScheduledAt };

  // Optimistically update local state
  setEntries(prev => prev.map(e =>
    e.id === entryId ? { ...e, scheduledAt: newDate.toISOString() } : e
  ));

  const resp = await fetch(`${API_BASE}/api/calendar-entries/${entryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt: newDate.toISOString() }),
  });

  if (!resp.ok) {
    // Revert on failure
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, scheduledAt: previousScheduledAt } : e
    ));
    toast({ variant: "destructive", title: "Failed to reschedule" });
    return;
  }

  const dateLabel = newDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  toast({
    title: `Rescheduled to ${dateLabel} at ${timeLabel}`,
    action: (
      <ToastAction altText="Undo reschedule" onClick={async () => {
        const ref = lastRescheduleRef.current;
        if (!ref) return;
        await fetch(`${API_BASE}/api/calendar-entries/${ref.entryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: ref.previousScheduledAt }),
        });
        setEntries(prev => prev.map(e =>
          e.id === ref.entryId ? { ...e, scheduledAt: ref.previousScheduledAt } : e
        ));
        toast({ title: "Reverted" });
      }}>Undo</ToastAction>
    ),
    duration: 15000,
  });
}, [entries, toast]);
```

- [ ] **Step 3: Update handleDrop to call commitReschedule directly**

In `handleDrop`, replace any `setPendingReschedule(...)` call with a direct call to `commitReschedule(entryId, newDate)`.

Also update `handleDrop`'s `useCallback` dependency array to include `commitReschedule` (it currently depends on `[year, month, toast, entries]`). Add `commitReschedule` to avoid stale closure bugs.

- [ ] **Step 4: Commit**

```bash
git add artifacts/sparqmake/src/pages/Calendar.tsx
git commit -m "feat: replace confirm toast with undo reschedule pattern in Calendar"
```

---

## Task 17: Pending Asset Badge in Sidebar

**Files:**
- Modify: `artifacts/sparqmake/src/components/layout/Sidebar.tsx`

**Dependency:** Requires pagination (Task 5) to be complete.

- [ ] **Step 1: Add pending asset count fetch**

In `Sidebar.tsx`, after the `calendarCount` state and `useEffect` (around line 68), add:

```typescript
const [pendingAssetCount, setPendingAssetCount] = useState(0);

useEffect(() => {
  fetch(`/api/assets?status=uploaded&limit=1`, { credentials: "include" })
    .then(res => res.json())
    .then(data => setPendingAssetCount(data.total || 0))
    .catch(() => {});
}, []);
```

- [ ] **Step 2: Add badge to Asset Library nav item**

In the `NAV_ITEMS` array (line 72), update the Asset Library entry:
```typescript
{ href: "/assets", label: "Asset Library", icon: Library, badge: pendingAssetCount || undefined },
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/sparqmake/src/components/layout/Sidebar.tsx
git commit -m "feat: show pending asset count badge in Sidebar"
```

---

## Task 18: Empty States on All Pages

**Files:**
- Modify: `artifacts/sparqmake/src/pages/AssetLibrary.tsx`
- Modify: `artifacts/sparqmake/src/pages/Calendar.tsx`
- Modify: `artifacts/sparqmake/src/pages/ReviewQueue.tsx`
- Modify: `artifacts/sparqmake/src/pages/ContentPlan.tsx`
- Modify: `artifacts/sparqmake/src/pages/CostDashboard.tsx`
- Modify: `artifacts/sparqmake/src/pages/CampaignStudio.tsx`

- [ ] **Step 1: Add empty state to each page**

Import in each file:
```typescript
import { EmptyState } from "@/components/ui/empty-state";
```

Import the appropriate Lucide icon for each page.

For each page, find the main content area where data is rendered. Add a conditional empty state:

**AssetLibrary.tsx** — where the asset grid is rendered:
```tsx
{assets?.data?.length === 0 && !isLoading && (
  <EmptyState icon={ImagePlus} title="No assets yet" description="Upload brand assets to start building campaigns" actionLabel="Upload Assets" onAction={() => { /* trigger upload dropzone */ }} />
)}
```

**Calendar.tsx** — where the calendar grid is rendered:
```tsx
{entries.length === 0 && !isLoading && (
  <EmptyState icon={CalendarPlus} title="Calendar is empty" description="Schedule campaigns to see them here" />
)}
```

**ReviewQueue.tsx** — when all kanban columns are empty:
```tsx
{campaigns?.data?.length === 0 && !isLoading && (
  <EmptyState icon={ClipboardCheck} title="Nothing to review" description="Campaigns submitted for review will appear here" />
)}
```

**ContentPlan.tsx** — when plan items are empty:
```tsx
{planItems.length === 0 && !isLoading && (
  <EmptyState icon={FileSpreadsheet} title="No content planned" description="Import a CSV or create your first content plan item" actionLabel="Import CSV" onAction={() => { /* trigger CSV import */ }} />
)}
```

**CostDashboard.tsx** — when summary has no data:
```tsx
{(!summary || summary.totalCost === 0) && !isLoading && (
  <EmptyState icon={BarChart3} title="No spending data" description="API costs will appear here after your first generation" />
)}
```

**CampaignStudio.tsx** — initial state before brand selection:
```tsx
{!selectedBrand && generatedVariants.length === 0 && (
  <EmptyState icon={Sparkles} title="Start a campaign" description="Select a brand and template to begin" />
)}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/sparqmake/src/pages/AssetLibrary.tsx artifacts/sparqmake/src/pages/Calendar.tsx artifacts/sparqmake/src/pages/ReviewQueue.tsx artifacts/sparqmake/src/pages/ContentPlan.tsx artifacts/sparqmake/src/pages/CostDashboard.tsx artifacts/sparqmake/src/pages/CampaignStudio.tsx
git commit -m "feat: add meaningful empty states to all pages"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Server starts without errors: `cd /tmp/SparqMake && pnpm --filter api-server run dev`
- [ ] Frontend builds: `cd /tmp/SparqMake && pnpm --filter sparqmake run build`
- [ ] TypeScript compiles: `cd /tmp/SparqMake && pnpm --filter sparqmake run typecheck` (if script exists)
- [ ] Brand readiness endpoint returns correct shape: `curl http://localhost:5000/api/brand-readiness/{brandId}`
- [ ] Paginated endpoints return `{ data, total, limit, offset }` shape
- [ ] Generate rejects unapproved assets with 400
- [ ] Generate rejects incomplete brands with 400
- [ ] Settings PUT rejects invalid body with 400
- [ ] Rewrite POST rejects missing fields with 400
