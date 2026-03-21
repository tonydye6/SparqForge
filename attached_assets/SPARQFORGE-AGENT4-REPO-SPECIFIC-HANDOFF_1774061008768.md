# SparqForge Agent 4 Repo-Specific Handoff

## Purpose

This handoff replaces the earlier abstract implementation guidance with directions that map directly onto the current SparqForge repository.

The current app is:
- Vite + React frontend in `artifacts/sparqforge`
- Express API server in `artifacts/api-server`
- Drizzle/Postgres schema in `lib/db/src/schema`
- generated API client/types in `lib/api-zod` and `lib/api-client-react` ([current repo commit](https://github.com/tonydye6/SparqForge/commit/c6816f9325b34d67838a845f3e504ae3b588e19b), [App.tsx](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/App.tsx), [DB schema index](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/lib/db/src/schema/index.ts)).

## Main Product Shift

SparqForge should stop behaving like a flat asset picker and start behaving like a role-aware reference-packet engine.

That means the highest-impact upgrade is not cosmetic. It is structural.

## Current Constraints To Respect

### 1. The existing data model is live
Do not rewrite the app around a new framework. Extend the current Drizzle schema.

### 2. The current generate flow already works
Do not break:
- campaign creation
- reference analysis
- SSE generation progress
- compositing
- cost logging
- scheduling and publishing ([generate route](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/routes/generate.ts), [publish scheduler](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/services/publish-scheduler.ts)).

### 3. The current weak point is pre-generation intelligence
Right now, Campaign Studio still uses a flat ordered asset list, and `assembleContext()` still only knows primary vs supporting assets ([CampaignStudio.tsx](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/pages/CampaignStudio.tsx), [context-assembly.ts](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/services/context-assembly.ts)).

## Required Workstreams

### Workstream 1: Schema expansion
Add asset intelligence, pairing memory, generation-packet logging, and content-plan support.

### Workstream 2: Asset Library and Settings upgrades
Support grouped brand asset management and advanced metadata editing.

### Workstream 3: Campaign Studio upgrade
Move from flat asset array selection to role-based packet assembly with packet preview.

### Workstream 4: Content plan layer
Add a planning object so strategy can live in the app before campaign creation.

### Workstream 5: Logging and measurement
Track packet quality, pairing quality, and strategy quality.

## Highest-Impact Files To Modify

### DB schema
- `lib/db/src/schema/assets.ts`
- `lib/db/src/schema/brands.ts`
- `lib/db/src/schema/campaigns.ts`
- `lib/db/src/schema/index.ts`
- add new schema files for pairings, packet logs, and content plan items

### Server routes/services
- `artifacts/api-server/src/routes/assets.ts`
- `artifacts/api-server/src/routes/brands.ts`
- `artifacts/api-server/src/routes/campaigns.ts`
- `artifacts/api-server/src/routes/generate.ts`
- `artifacts/api-server/src/services/context-assembly.ts`
- add new service for packet assembly
- add new routes for content plan import/list/create-campaign

### Frontend
- `artifacts/sparqforge/src/pages/AssetLibrary.tsx`
- `artifacts/sparqforge/src/pages/Settings.tsx`
- `artifacts/sparqforge/src/pages/CampaignStudio.tsx`
- add new content plan page or section

## Delivery Standard

When this repo-specific work is complete, SparqForge should be able to:
- store richer asset intelligence
- recommend the right 2–3 references for a generation run
- keep logos and exact marks out of model reference packets when they should be composited
- import and manage planned posts
- convert a plan item into a preloaded campaign draft
- log which packet was used and whether it worked
