# SparqForge Agent 4 Implementation QA Checklist

## Purpose

Use this checklist to review Agent 4’s implementation of the upgraded asset system, packet logic, and content-plan layer.

## Schema QA

- Asset schema includes role-aware metadata fields
- New tables for pairings, packet logs, and content plan exist
- Existing data still works after migration
- Backfill defaults are sensible

## API QA

- Asset routes support new filters and metadata updates
- Content plan routes exist and work
- Generation flow logs packet details
- No existing generation routes were broken

## UI QA

- Brand Settings supports grouped brand assets
- Asset Library exposes the new metadata fields clearly
- Campaign Studio has role-based asset slots
- Packet preview explains what will be sent vs composited
- Content plan import and list view work

## Workflow QA

- A content plan item can become a campaign draft
- Suggested assets are narrowed intelligently
- Logos are not being pushed into generation when they should be composited
- Legacy or conflict-tagged assets are suppressed or warned against

## Calibration QA

- First 8 posts can be set up cleanly in the app
- Packet choices feel materially better than the old flat model
- Reviewers can understand what packet was used
- Refinement logs still work

## Regression QA

- Existing campaign creation still works
- Reference URL analysis still works
- Scheduling still works
- Instagram, X, and LinkedIn publish paths still work

## Final QA Question

Does SparqForge now feel like a smarter brand operating system, or just the same app with more fields?
If it feels like the latter, more work is needed.
