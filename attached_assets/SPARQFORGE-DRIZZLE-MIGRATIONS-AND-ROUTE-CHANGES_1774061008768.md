# SparqForge Exact Drizzle Migrations and Route Changes

## Purpose

This document gives Agent 4 the exact structural changes to make in the current SparqForge repo.

## Drizzle Schema Changes

### Extend `assetsTable`
In `lib/db/src/schema/assets.ts`, add:
- `assetClass`
- `generationRole`
- `brandLayer`
- `franchise`
- `approvedChannels` as `text().array()`
- `approvedTemplates` as `text().array()`
- `subjectIdentityScore` as `integer`
- `styleStrengthScore` as `integer`
- `compositingOnly` as `boolean`
- `generationAllowed` as `boolean`
- `approvedForCompositing` as `boolean`
- `approvedForPromptAssembly` as `boolean`
- `referencePriorityDefault` as `integer`
- `freshnessScore` as `integer`
- `approvalScore` as `integer`
- `exactnessRequired` as `boolean`
- `conflictTags` as `text().array()`
- `versionLabel`
- `sourceOfTruthLocation`
- `retiredReason`

Also add indexes for:
- brandId + assetClass
- brandId + generationAllowed
- brandId + franchise

### Extend `brandsTable`
Do not remove `logoFileUrl`, but add:
- `brandAssetConfig` as `json`

This field should store grouped asset references for:
- primary logo
- alternate logo
- monochrome logo
- watermark
- endorsement lockup
- partner/compliance marks
- style plates
- founder assets
- gameplay references

### Add new table `assetPairingsTable`
Create new schema file: `lib/db/src/schema/asset-pairings.ts`

Fields:
- id
- primaryAssetId
- secondaryAssetId
- templateId
- platform
- firstPassApproved
- totalRefinements
- finalStatus
- usageCount
- avgApprovalScore
- createdAt
- updatedAt

### Add new table `generationPacketLogsTable`
Create new schema file: `lib/db/src/schema/generation-packet-logs.ts`

Fields:
- id
- campaignId
- platform
- templateId
- packetType
- primaryAssetId
- supportingAssetIds as json
- styleAssetIds as json
- contextAssetIds as json
- compositingAssetIds as json
- excludedAssetIds as json
- packetReasoning as json
- createdAt

### Add new table `socialContentPlanItemsTable`
Create new schema file: `lib/db/src/schema/social-content-plan-items.ts`

Fields:
- id
- title
- campaignName
- primaryPlatform
- secondaryPlatforms as text array
- templateName
- pillar
- audience
- brandLayer
- objective
- contentType
- assetPacketType
- coreMessage
- cta
- requiredAssetRoles as text array
- status
- plannedWeek
- plannedDate
- notes
- createdAt
- updatedAt

### Update schema exports
Update `lib/db/src/schema/index.ts` to export the new tables.

## Route Changes

### `assets.ts`
Add support for reading/writing the new asset metadata fields.
Add filter support for:
- assetClass
- generationAllowed
- compositingOnly
- franchise
- approvedTemplates
- approvedChannels

Add a route for recommended assets, for example:
- `GET /assets/recommended`

Inputs:
- brandId
- templateId
- platform
- optional packetType

### `brands.ts`
Allow updating `brandAssetConfig`.

### `campaigns.ts`
Add routes for content-plan conversion:
- `POST /content-plan/import`
- `GET /content-plan`
- `POST /content-plan/:id/create-campaign`

### `generate.ts`
Before `assembleContext()`, insert a packet-building step.

Suggested new service call:
- `buildGenerationPacket({ campaignId, brandId, templateId, platform })`

Then pass the packet output into `assembleContext()`.

Also log the packet into `generationPacketLogsTable`.

### `context-assembly.ts`
Refactor to accept role-aware packet input instead of only primary + supporting asset assumptions.

## Migration / rollout order

1. Add schema fields/tables
2. update server routes and types
3. backfill existing assets with default classifications
4. update frontend settings and asset library
5. update Campaign Studio role-aware selection
6. add packet builder and packet preview
7. add content plan import flow

## Backfill defaults

- logo assets → compositing only
- context assets → prompt assembly only
- character_art → subject reference
- gameplay screenshots → subject or style depending on admin choice
- backgrounds → style reference

## Deliverable standard

Agent 4 should implement this as a layered extension of the live repo, not a speculative redesign.
