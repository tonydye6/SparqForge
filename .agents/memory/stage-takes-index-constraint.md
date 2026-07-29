---
name: stage_takes take_index constraint vs 0-based code
description: DB CHECK requires take_index >= 1 but explore-run inserts 0-based indexes; whole spread fails AFTER generation, spending money with zero cost rows.
---
The `stage_takes_index_positive_check` constraint is `CHECK (take_index >= 1)`, but the explore-run route inserts `takeIndex: existing.length` (0 for the first take). The spine takes endpoint uses `nextTakeIndex` from stage-graph, which is also 0-based-compatible? No — the constraint means the FIRST take on a slot must have index >= 1.

**Why it matters:** the failure happens AFTER all 8 images are generated and stored. The transaction rolls back the takes, the catch handler deletes the reservation, and no `explore_spread` row is settled — so ~$0.48 of real spend leaves NO trace in cost_logs. The API responds "Nothing was charged", which is false with respect to the upstream provider.

**How to apply:** any take-recording path must insert take_index starting at 1 (or the constraint must be relaxed to >= 0), and any fix should reconcile with `nextTakeIndex` in stage-graph.ts. Unit tests didn't catch this because they mock the DB — an integration test hitting the real schema would have.

Observed 2026-07-29 during the first paid Explore verification (merge of "Stage 03: wire Explore generation"). Generated files persist at `generated/<creativeId>_explore_<slot>_<hash>.png` even when the run 500s.
