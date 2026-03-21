# SparqForge Agent 4 Repo-Specific Execution Prompt

Read these files first:
- SPARQFORGE-AGENT4-REPO-SPECIFIC-HANDOFF.md
- SPARQFORGE-DRIZZLE-MIGRATIONS-AND-ROUTE-CHANGES.md
- SPARQFORGE-FIRST-8-POSTS-EXECUTION-PACK.md
- SPARQFORGE-ASSET-SYSTEM-AND-GENERATION-STRATEGY.md
- SPARQFORGE-30-POST-SOCIAL-CALENDAR-V2.md
- SPARQFORGE-SOCIAL-SYSTEM-MATURITY-AND-MEASUREMENT-PLAN.md

Also use the live repo structure as source of truth. This is a Vite React + Express + Drizzle monorepo, not a Next.js + Prisma app.

## Mission

Upgrade SparqForge so the real codebase moves from a flat asset picker to a role-aware reference-packet engine.

## Critical rules

- Do not rewrite the app architecture.
- Extend the existing Drizzle schema and Express routes.
- Preserve existing generate, compositing, scheduling, publishing, and review behavior.
- Add new capability in layers.

## Build priorities

### Priority 1
Implement schema extensions for:
- asset intelligence
- asset pairings
- generation packet logs
- social content plan items

### Priority 2
Upgrade Asset Library and Brand Settings to support:
- grouped brand assets
- advanced asset metadata
- role-aware asset editing

### Priority 3
Upgrade Campaign Studio to support:
- role-based asset slots
- packet preview
- recommended assets by template/platform

### Priority 4
Insert packet assembly before `assembleContext()` in the generation flow.

### Priority 5
Add content plan import and create-campaign-from-plan-item flow.

## Validation standard

When complete, the app should be able to execute the first 8 calibration posts from the execution pack with significantly better asset-role clarity and packet selection than the current flat model.

## Required output from Agent 4

When done, report:
- which schema files changed
- which routes changed
- which pages changed
- what was seeded or backfilled
- what still remains for TikTok and YouTube backend support
