# SparqMake Asset System and Generation Strategy

## Purpose

This document defines how SparqMake should store, classify, prioritize, and assemble brand assets so the generation pipeline can get the best possible outputs from a limited number of reference images per call. This is the missing operating layer between “we have assets” and “the models can consistently produce strong social content.”

It is grounded in SparqMake’s current product and pipeline docs, which already separate brand DNA, templates, selected assets, and context cards in deterministic application code before generation runs ([GENERATION_PIPELINE.md attachment](#), [PRD_SparqMake-3.md attachment](#), [TECH_SPEC-5.md attachment](#)). It also aligns to Google’s current guidance that reference-image-based image generation benefits from explicit reference roles and that, in some official Imagen customization paths, requests support a limited number of reference image objects, including subject and style references ([Google Cloud Imagen customization docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/imagen-api-customization), [Google Cloud prompt guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide)).

## Core Principle

Do not treat all uploaded media as equal.

SparqMake should treat each asset as one of several distinct reference roles, because the generation models and the compositing pipeline do not use all images the same way:
- some assets should be passed into generation as subject references
- some should be passed as style references
- some should never be sent to generation and should only be composited afterward
- some are not visual references at all and should be used as text context only

If the system does not distinguish those roles, users will over-send noisy references, waste slots, and degrade outputs.

## The Right Mental Model

SparqMake needs two connected systems, not one:

1. Asset Library
This is the master repository of all approved content objects.

2. Generation Context Assembler
This is the logic layer that selects only the best few assets for the current generation request.

The library should be broad. The generation packet should be narrow.

## Four Asset Classes

### Class 1: Compositing Assets
These assets should almost never be sent to Imagen or Veo as creative reference inputs. They belong to the finishing layer.

Examples:
- primary logos
- alternate logos
- lockups
- official wordmarks
- sponsor/partner logos
- school marks when they must remain exact
- watermark elements

Why:
These assets require fidelity. If passed into generation, they will often be distorted or approximated. SparqMake’s own compositing architecture is already designed to overlay logos and text after generation, which is the correct method ([GENERATION_PIPELINE.md attachment](#)).

Required fields:
- asset_class = compositing
- compositing_role = primary_logo | secondary_logo | watermark | endorsement_lockup | partner_logo
- exactness_required = true
- approved_for_generation = false
- approved_for_compositing = true

### Class 2: Subject Reference Assets
These are the most important generation inputs. They tell the model what or who must remain recognizable.

Examples:
- character renders
- athlete portraits used for likeness-driven work
- mascot poses
- specific gameplay hero subjects
- product/device hero shots if ever needed

Why:
These assets define the “who” or “what” of the output. Subject references should usually dominate the reference set.

Required fields:
- asset_class = subject_reference
- subject_type = character | athlete | mascot | gameplay_subject | object
- franchise = Sparq | Crown U | Rumble U | Mascot Mayhem
- exactness_required = medium or high
- approved_for_generation = true
- reference_priority_default = 1

### Class 3: Style Reference Assets
These assets define the look, mood, composition, lighting, and texture behavior, not the literal subject.

Examples:
- approved social posts
- approved mood images
- approved backgrounds
- approved campaign hero art
- premium design comps
- environment shots with the right atmosphere

Why:
The model often needs a “how should this feel” reference that is separate from “what is in the frame.”

Required fields:
- asset_class = style_reference
- style_domain = social_graphic | gameplay_mood | texture | environment | campaign_visual
- visual_mode = restrained | standard | high_force
- approved_for_generation = true
- reference_priority_default = 2

### Class 4: Context Assets
These do not go into image generation directly. They improve prompt assembly and copy generation.

Examples:
- campaign briefs
- compliance notes
- licensing language
- partner messaging instructions
- rivalry notes
- launch context
- school-specific notes

Why:
These give the system strategic and textual context without wasting image reference slots.

Required fields:
- asset_class = context
- content_type = brief | compliance | campaign_note | school_note | messaging
- approved_for_generation = false
- approved_for_prompt_assembly = true

## The Metadata Schema SparqMake Actually Needs

The current schema already has useful foundations like type, subtype, status, tags, usage count, and brand association ([TECH_SPEC-5.md attachment](#)). It should be expanded with these fields.

### Required Metadata Fields
- asset_class
- generation_role
- brand_layer
- franchise
- campaign_fit
- approved_channels
- approved_templates
- subject_identity_score
- style_strength_score
- compositing_only
- generation_allowed
- recommended_pairings
- conflict_tags
- reference_priority_default
- freshness_score
- approval_score
- source_of_truth_location
- version_label
- retired_reason

### Field Definitions

#### asset_class
Allowed values:
- compositing
- subject_reference
- style_reference
- context

#### generation_role
Allowed values:
- primary_subject
- supporting_subject
- style_anchor
- background_mood
- texture_reference
- compositing_logo
- compositing_partner_mark
- text_context

#### brand_layer
Allowed values:
- parent_brand
- game_brand
- platform_product
- partnership

#### franchise
Allowed values:
- Sparq
- Crown U
- Rumble U
- Mascot Mayhem
- Multi-brand

#### approved_channels
Allowed multiple values:
- Instagram
- X
- LinkedIn
- TikTok
- YouTube

#### approved_templates
This should whitelist which templates an asset is good for, not assume every approved asset is good everywhere.

Examples:
- Character Reveal
- Gameplay Spotlight
- Partnership Announcement
- Founder Quote
- Ecosystem Explainer
- Brand Manifesto

#### subject_identity_score
1 to 5 score for how strong the asset is as a subject reference.

#### style_strength_score
1 to 5 score for how strong the asset is as a style reference.

#### compositing_only
Boolean.

#### generation_allowed
Boolean.

#### recommended_pairings
Array of asset IDs or pairing groups. This is where Agent 4’s intuition about “which assets worked well together” becomes structured data.

#### conflict_tags
Assets should carry flags like:
- outdated_style
- old_character_anatomy
- legacy_palette
- token_brand_conflict
- placeholder_only

That lets the system suppress or warn against bad combinations.

#### freshness_score
1 to 5 score for how current the asset is relative to the live brand system.

#### approval_score
1 to 5 score for how trusted the asset is in production.

## The Selection Strategy

Because generation can only meaningfully use a few references at once, SparqMake should not ask the user to think in terms of a giant basket of images. It should build a best-of packet.

### Default Selection Rule
For most image generations, the system should assemble:
- 1 primary subject reference
- 1 supporting subject OR 1 style reference
- 1 optional style/background reference
- 0 logos sent to generation
- logos applied in compositing only

That means the common generation packet is 2 to 3 reference images, not 8 to 12.

### Recommended Priority Formula
Use a weighted scoring model:

selection_score =
(brand_match × 3) +
(template_match × 3) +
(asset_role_fit × 4) +
(subject_identity_score × 4) +
(style_strength_score × 3) +
(freshness_score × 2) +
(approval_score × 3) +
(pairing_bonus × 2) -
(conflict_penalty × 5)

### Hard Filters Before Scoring
Do not even consider assets if:
- status is not approved
- generation_allowed is false
- franchise mismatches the current campaign unless the asset is multi-brand approved
- approved_templates excludes the current template
- conflict_tags include outdated_style or placeholder_only for a public-facing asset

## Asset Slots by Template Type

### Character Reveal
Use:
- slot 1: primary subject reference
- slot 2: style reference or approved branded background
- slot 3: optional second subject for consistency if needed

Do not use logos as reference inputs.

### Gameplay Spotlight
Use:
- slot 1: gameplay screenshot or gameplay subject reference
- slot 2: style reference showing the intended visual mood
- slot 3: optional character or environment reference

### Partnership Announcement
Use:
- slot 1: relevant hero subject or environment
- slot 2: style reference for premium announcement look
- compositing layer: all exact logos and marks

### Founder Quote / Category Narrative
Use:
- slot 1: style reference only, if the asset is mostly graphic/motion-led
- slot 2: optional background mood asset
- text and logos handled in compositing

### Ecosystem Explainer
Often do not send many image references at all. This is usually better served by layout-led compositing and structured templates.

## What Brand Settings Should Support

The current Brand Settings concept needs to be expanded beyond a single logo upload, exactly as you flagged.

Each brand should support multiple asset groups:

### Brand Marks
- primary logo
- alternate logo
- monochrome logo
- watermark mark
- endorsement lockup
- favicon/icon mark

### Brand Backgrounds
- approved dark backgrounds
- approved gradient backgrounds
- approved texture backgrounds
- approved atmosphere plates

### Character and Subject Sets
- approved hero character set
- approved athlete likeness set
- approved mascot set
- retired or legacy set hidden from normal generation

### Gameplay and Product Screens
- approved gameplay screenshots
- approved UI shots
- approved device mockups

### Partnership / Compliance Assets
- partner logos
- school marks
- compliance overlays
- CLC-safe templates

## The UX SparqMake Needs

### In Brand Settings
The UI should not be “upload one logo.” It should be a structured brand asset manager with sections:
- Logos and marks
- Character references
- Gameplay references
- Backgrounds and style plates
- Partner/compliance marks
- Context cards

### In Campaign Studio
Users should not pick arbitrary assets in a vacuum. The UI should guide them through roles:
- Primary subject
- Supporting subject
- Style / mood
- Context cards

The system should also auto-suggest the highest-scoring assets for the chosen brand + template combination.

### Smart Defaults
When a template is selected, the system should automatically surface:
- top 3 recommended subject references
- top 3 recommended style references
- top context cards
- the exact logos that will be applied at compositing time

That way, the user is selecting from a narrowed, intelligent set instead of browsing the whole library.

## Recommendation Layer

Agent 4 is right that usage context matters. But usage frequency alone is not enough. The recommendation layer should store outcome quality.

Track:
- which asset combinations were used together
- which combinations were approved on first pass
- which combinations produced refinements
- which combinations were rejected
- which combinations were successful per template and platform

This creates a pairing-memory system, not just a popularity system.

### Example Recommendation Data
Store records like:
- primary_asset_id
- secondary_asset_id
- template_id
- platform
- first_pass_approved
- total_refinements
- final_status
- campaign_id

Then surface suggestions such as:
- “This character reference + this background plate has a 92% approval rate for Character Reveal on Instagram.”

## Asset Lifecycle Rules

### Statuses
Use more than uploaded / approved / archived. Add:
- draft
- approved_for_generation
- approved_for_compositing
- approved_for_both
- restricted
- legacy
- archived

### Why
A logo may be approved for compositing but not for generation.
A gameplay screenshot may be approved for generation but not for public LinkedIn use.
A character image may be approved generally but retired from the latest style system.

## Best-Result Operating Rules

- Never send exact logos into image generation when compositing can preserve fidelity.
- Never let users send too many references by default.
- Separate subject references from style references in both data and UI.
- Score assets for the current job instead of treating approval as universal.
- Capture pairing success, not just usage count.
- Hide legacy assets from normal workflows unless explicitly requested.
- Make template-aware asset suggestion the default behavior.

## Recommended Build Changes for Agent 4

### Database additions
Add fields for:
- assetClass
- generationRole
- approvedChannels
- approvedTemplates
- subjectIdentityScore
- styleStrengthScore
- compositingOnly
- generationAllowed
- freshnessScore
- approvalScore
- recommendedPairings
- conflictTags
- versionLabel

### UI additions
Add:
- multi-logo management in Brand Settings
- role-based asset selection in Campaign Studio
- auto-suggested reference packs
- “generation packet preview” before running models
- asset pairing recommendations
- legacy-asset suppression warnings

### Pipeline additions
Add a deterministic preflight step:
1. filter approved assets
2. classify by role
3. score for current template and channel
4. assemble best packet
5. send only the top packet to generation
6. keep logos and exact marks for compositing only

## Final Recommendation

The best way I can help is by giving you the system design that Agent 4 can implement directly.

The right answer is not “let users upload a bunch of assets.” The right answer is to make SparqMake behave like a reference-packet engine:
- broad library
- strict metadata
- role-aware selection
- template-aware narrowing
- few-image generation packets
- exact logo compositing
- outcome-driven recommendations

That is how you get better outputs while staying aligned to the real behavior of multimodal generation systems and to SparqMake’s current architecture ([GENERATION_PIPELINE.md attachment](#), [TECH_SPEC-5.md attachment](#), [Google Cloud Imagen customization docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/imagen-api-customization), [Google Cloud prompt guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide)).
