# SparqForge 30-Post Social Calendar V2

## Purpose

This is a revised 30-post calendar built around the actual current state of the SparqForge codebase rather than the earlier spec-only understanding. It is designed to help Sparq use content strategy to improve both the brand and the product at the same time.

This version assumes:
- the app already has real generation, scheduling, review, and publishing infrastructure in place for some platforms
- the asset model is still too flat
- packet assembly is still too simple
- TikTok and YouTube are not yet wired as deeply as Instagram, X, and LinkedIn in backend publishing flows
- the strategy should be phased around system maturity, not just marketing ambition ([current repo commit](https://github.com/tonydye6/SparqForge/commit/c6816f9325b34d67838a845f3e504ae3b588e19b), [CampaignStudio implementation](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/pages/CampaignStudio.tsx), [publish scheduler](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/services/publish-scheduler.ts), [assets schema](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/lib/db/src/schema/assets.ts)).

## New Planning Model

The 30-post plan is now split into three phases:
- Calibration Phase
- Operating Phase
- Scale Phase

The earlier 30-post strategy stays directionally correct, but this version adds:
- system purpose
- required product capability
- realistic platform path
- evaluation criteria

## Phase 1: Calibration

Goal:
Use content to stress-test the app’s weak spots and validate the right product changes before scale.

These posts should be built first because they test the system’s hardest current jobs.

### Posts 1–8

| # | Post | Core Type | Main System Purpose | Required Capability | Platform Path | Evaluation |
|---|---|---|---|---|---|---|
| 1 | What Sparq Is | Thesis graphic | Validate text-heavy brand statement execution | strong style asset selection + compositing fidelity | LinkedIn publish, Instagram export | clarity of category claim |
| 2 | School Pride Should Live Somewhere | Motion statement | Validate brand-world visual language | style-led packet selection | Instagram publish/export | emotional resonance + premium feel |
| 3 | Why This Category Exists | Founder narrative | Validate founder-led narrative flow | founder asset handling + long-form variation | YouTube manual/export, LinkedIn cutdown | narrative coherence |
| 4 | Competition Is Still Underserved | Commentary | Validate concise point-of-view copy | context-card driven text generation | X publish | sharpness of message |
| 5 | Signal Feed 01 | Statement visual | Validate Signal Chaos repeatability | style-only packet + compositing logo | Instagram publish, X export | visual recognizability |
| 6 | Ecosystem Map 01 | Explainer | Validate low-subject explainers | diagram/context-first assembly | LinkedIn publish, Instagram export | ecosystem clarity |
| 7 | Built Different 01 | Proof graphic | Validate system-proof messaging | context + systems visual packet | LinkedIn publish | proof readability |
| 8 | Character World Signal | World-building | Validate subject + style packet behavior | role-aware subject/style assembly | Instagram publish/export | subject consistency |

## Phase 2: Operating

Goal:
Run the system in a disciplined recurring mode once packet logic and metadata improve.

### Posts 9–20

| # | Post | Core Type | Main System Purpose | Required Capability | Platform Path | Evaluation |
|---|---|---|---|---|---|---|
| 9 | Crown U as Flagship Proof | Bridge post | connect parent brand to flagship | gameplay asset fit | LinkedIn publish | parent-to-flagship logic |
| 10 | Why NIL Matters Here | Mission post | connect athlete value to brand | subject + context control | Instagram publish/export | legitimacy |
| 11 | Signal Feed 02 | Statement visual | repeat visual language | reusable style packet | Instagram publish, X export | consistency |
| 12 | Founder Cut 01 | Founder narrative | develop repeatable founder series | founder packet templates | YouTube export/manual | depth |
| 13 | Ecosystem Map 02 | Systems explainer | explain product architecture | diagram/context-first flow | Instagram export, LinkedIn publish | system understanding |
| 14 | Fandom Truth 01 | Commentary | establish category worldview | short-form text reliability | X publish | memorability |
| 15 | Gameplay Means Identity | Gameplay bridge | connect product energy to brand logic | gameplay/style pairing | Instagram publish/export | gameplay relevance |
| 16 | Why We’re Not Just a Studio | Category statement | reinforce company model | context-first post type | LinkedIn publish | category precision |
| 17 | School Spirit Rewired 01 | Cultural insight | test fan-truth short-form | short-form adaptation | TikTok export/manual | hook strength |
| 18 | Investor-Legibility Cut 01 | Strategic proof | align social to investor story | proof template control | LinkedIn publish | strategic readability |
| 19 | Signal Feed 03 | Statement visual | maintain brand memory | reusable packet logic | Instagram publish | recall |
| 20 | Partnership Proof 01 | Credibility signal | validate external proof pattern | partnership asset + compositing | LinkedIn publish | trust signal |

## Phase 3: Scale

Goal:
Expand once packet intelligence, grouped brand assets, and content-plan infrastructure exist.

### Posts 21–30

| # | Post | Core Type | Main System Purpose | Required Capability | Platform Path | Evaluation |
|---|---|---|---|---|---|---|
| 21 | Founder Cut 02 | Long-form founder | grow narrative library | founder series system | YouTube export/manual | long-form retention |
| 22 | Brand Voltage 01 | High-force campaign asset | test campaign spike logic | stronger packet confidence | TikTok export/manual, Instagram publish | memorability |
| 23 | Ecosystem Map 03 | Hierarchy explainer | test layered portfolio story | mature content-plan support | LinkedIn publish | hierarchy clarity |
| 24 | Fandom Truth 02 | Commentary | broaden worldview library | reusable text pattern | X publish | distinctiveness |
| 25 | Built Different 02 | Systems proof | compound proof storytelling | systems-visual reuse | LinkedIn publish | proof compounding |
| 26 | Brand Voltage 02 | Hero motion post | test spike asset quality at scale | motion style system | Instagram publish/export | premium impact |
| 27 | Gameplay Spotlight 02 | Gameplay bridge | mature gameplay-to-brand template | better pairings memory | Instagram publish/export | conversion to curiosity |
| 28 | Founder Cut 03 | Why now narrative | deepen timing argument | content-plan + founder library | YouTube export/manual | why-now clarity |
| 29 | School Spirit Rewired 02 | Culture post | maintain fan-emotion series | short-form repeatability | TikTok export/manual | audience resonance |
| 30 | Ecosystem Closing Statement | Closing thesis | test summary/series payoff | mature planning + packet reliability | LinkedIn publish, Instagram export | memory of whole system |

## Revised Platform Logic

### Publish-supported now
The current codebase is materially real for:
- Instagram
- X / Twitter
- LinkedIn ([publish scheduler](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/services/publish-scheduler.ts), [social auth routes](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/routes/social-auth.ts)).

### Generate-and-export supported or partially supported
The current codebase can meaningfully support generation for:
- TikTok-style assets in UI and preview
- YouTube-oriented visual/video assets at the content level

But these should still be treated as manual/export workflows until backend support is implemented more deeply ([CampaignStudio implementation](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/pages/CampaignStudio.tsx)).

## Priority Product Gaps That Change Strategy

### Gap 1: Flat asset roles
The current system still models asset selection as one primary plus the rest supporting. That means subject-heavy posts and style-heavy posts are still under-modeled ([CampaignStudio implementation](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/pages/CampaignStudio.tsx), [context assembly service](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/api-server/src/services/context-assembly.ts)).

### Gap 2: No content-plan layer
Campaigns exist. Calendar entries exist. But a true planning object does not yet exist, so the strategy should not assume planning and execution are elegantly separated yet ([campaigns schema](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/lib/db/src/schema/campaigns.ts), [Calendar page](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/artifacts/sparqforge/src/pages/Calendar.tsx)).

### Gap 3: Multiple brand marks and brand kits are not first-class yet
Brand settings still center around a single logo field plus fonts, which is not enough for the real operational need ([brands schema](https://github.com/tonydye6/SparqForge/blob/c6816f9325b34d67838a845f3e504ae3b588e19b/lib/db/src/schema/brands.ts)).

## Revised Success Criteria

Do not judge the first 8 posts by reach alone.

Judge them by:
- did the packet choice feel correct
- did the output need heavy editing
- did the chosen assets make sense together
- did the post teach the right brand idea
- was the platform path realistic in the current app

## Final Recommendation

The strategy should now be treated as product-aware.

That means the calendar is no longer just a publishing plan. It is a maturity roadmap for SparqForge itself. The first 8 posts are where the product earns the right to handle the next 22 with confidence.
