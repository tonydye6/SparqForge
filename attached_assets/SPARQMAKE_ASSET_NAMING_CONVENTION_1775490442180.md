# SPARQMAKE ASSET NAMING CONVENTION

**Standard for Asset Library Uploads**
Version 2.0 | April 2026
Sparq Games

---

## Why Naming Conventions Matter

SparqMake automatically classifies assets based on keywords in the filename. When you name a file correctly, the system auto-detects its asset class, generation role, compositing behavior, franchise, conflict tags, and brand layer. This means less manual configuration, fewer classification errors, and a faster path from upload to published content.

The keywords that trigger auto-classification are: **logo**, **character**, **char**, **background**, **mood**, **style**, **screenshot**, **render**, **gameplay**. Everything else defaults to `subject_reference`.

---

## The Naming Pattern

All filenames follow a consistent structure using underscores as separators and hyphens within multi-word segments:

```
{brand}_{type}_{subject}_{variant}.{ext}
```

### General Rules

- All lowercase
- Underscores (`_`) separate major segments
- Hyphens (`-`) join words within a segment (e.g., `skull-wordmark`, `red-white`)
- No spaces, no special characters, no parentheses
- Use numbered suffixes for variants: `_01`, `_02`, etc.
- Use PNG for raster images, SVG for vector logos
- Preserve original file extensions (do not convert between formats)

---

## Characters (Crown U)

The keyword **"char"** triggers `subject_reference` classification, making these the primary subjects for AI image generation.

### CRITICAL: Logo-Based Classification

**Characters are classified as Sparq-branded or university-branded based on the logos/icons on their uniforms, NOT their color scheme.** Every uniform colorway is technically a university color — colors alone are ambiguous and must not be used as the sole basis for classification.

- **Sparq flame icon or "SPARQ" / "SPARQ GAMES" wordmark** on uniform → Sparq-branded → filename uses `{colors}` field
- **University logo** on uniform (e.g., Georgia "G", Oregon "O" duck wing, Notre Dame shamrock, LSU tiger, Texas longhorn) → University-branded → filename uses `{school}` field
- **Cannot identify logo** → place in `_unclassified/` and note what was visible

### Sparq-Branded (Generic Colors)

Pattern: `crownu_char_{gender}_{colors}_{sport}_{pose}.{ext}`

| Example Filename | Description |
|---|---|
| `crownu_char_male_blue_basketball_default.png` | Male, blue uniform, basketball, standing |
| `crownu_char_female_blue-gold_soccer_action.png` | Female, blue/gold uniform, soccer, action pose |
| `crownu_char_male_navy-gold_lacrosse_default.png` | Male, navy/gold uniform, lacrosse, standing |

### University-Branded

Pattern: `crownu_char_{gender}_{school}_{sport}_{pose}.{ext}`

| Example Filename | Description |
|---|---|
| `crownu_char_male_lsu_football_default.png` | Male LSU football, standing |
| `crownu_char_female_georgia_gymnastics_action.png` | Female Georgia gymnast, action pose |
| `crownu_char_male_notre-dame_lacrosse_hero.png` | Male Notre Dame lacrosse, hero pose |

### Pose Vocabulary

Use these standard terms for the `{pose}` segment:

| Pose | Description |
|------|-------------|
| `default` | Standing neutral, no specific action |
| `action` | Dynamic action pose (jumping, swinging, kicking) |
| `hero` | Heroic/promotional stance, often facing camera |
| `ball` | Holding or interacting with a ball/equipment |
| `celebration` | Victory/celebration gesture |
| `a-pose` | Arms-out rigging/T-pose (technical reference) |
| `portrait` | Close-up, head/shoulders only |
| `relaxed` | Casual standing or leaning |

### Primary Purpose Rule

An image's primary purpose determines its category:

- A promotional poster featuring a character → `marketing/`, named `sparq_promo_*`
- A character render on a plain/studio background with no UI or text → `characters/`, named `crownu_char_*`
- When ambiguous, favor `characters/` (most valuable asset class for SparqMake)

### Multi-Subject Rule

Images containing characters from multiple schools: name based on the primary subject (largest, most centered character). Place in `characters/_unclassified/` and note all visible schools in any accompanying metadata.

---

## Logos

The keyword **"logo"** triggers `compositing` classification. Logos are routed to the Sharp compositing pipeline (overlay on generated images) and are never sent to Gemini as generation references.

### Sparq Parent Brand

Pattern: `sparq_logo_{layout}_{colorscheme}.{ext}`

| Example | Description |
|---|---|
| `sparq_logo_skull-wordmark_red.svg` | Skull + wordmark, red |
| `sparq_logo_skull_black.svg` | Skull only, black |
| `sparq_logo_vertical_black.png` | Vertical layout, black |
| `sparq_logo_profile_red.png` | Profile image, red |

### Game Brand Logos

| Brand | Pattern | Example |
|---|---|---|
| Crown U | `crownu_logo_{type}_{color}.{ext}` | `crownu_logo_wordmark_white.svg` |
| Rumble U | `rumbleu_logo_{type}_{color}.{ext}` | `rumbleu_logo_primary.png` |
| Mascot Mayhem | `mascotmayhem_logo_{type}_{color}.{ext}` | `mascotmayhem_logo_primary.svg` |

### University & Partner Logos

| Pattern | Example |
|---|---|
| `uni_logo_{school}.{ext}` | `uni_logo_alabama.svg` |
| `uni_logo_{school}_{variant}.{ext}` | `uni_logo_ohio-state_dark-bg.svg` |
| `partner_logo_{company}.{ext}` | `partner_logo_clc.png` |

---

## Backgrounds

The keyword **"background"** triggers `style_reference` classification. These assets provide aesthetic guidance to Gemini rather than being used as subjects.

Pattern: `style_background_{description}.{ext}`

| Example | Description |
|---|---|
| `style_background_arena-ground-level_01.png` | Arena ground level view |
| `style_background_grunge-wall_white.png` | White grungy wall texture |
| `style_background_title-slide_01.jpg` | Title slide background |

---

## Style Inspiration / Design References

The keyword **"style"** triggers `style_reference` classification. These are external reference images used for design direction and AI style guidance — not Sparq's own assets.

Pattern: `style_reference_{category}_{description}.{ext}`

### Categories

| Category | What it covers |
|----------|---------------|
| `sports-graphic` | Game scores, player cards, rosters, stat overlays, gameday posts |
| `branding` | Logo systems, brand identity, color palettes, style guides |
| `typography` | Type treatments, lettering, display fonts in context |
| `ui` | Game menus, character selects, loadout screens, component layouts |
| `photography` | Real sports photos — atmosphere, celebrations, action, stadiums |
| `illustration` | Character art, concept illustrations, stylized artwork |
| `layout` | Page compositions, grid systems, poster designs |

| Example | Description |
|---|---|
| `style_reference_sports-graphic_michigan-football-scoreboard.jpg` | Michigan game stats graphic |
| `style_reference_branding_chargers-identity-overview.png` | LA Chargers brand redesign |
| `style_reference_photography_cfb-championship-celebration.jpg` | Championship celebration photo |
| `style_reference_ui_character-select-screen.jpg` | Game character select UI |

---

## Marketing & Promotional

No auto-classification keyword — defaults to `subject_reference`.

Pattern: `sparq_promo_{description}.{ext}`

| Example | Description |
|---|---|
| `sparq_promo_game-day-hype.png` | Game day promotional graphic |
| `sparq_promo_championship-poster.png` | Championship poster |
| `sparq_promo_crown-u-new-season.png` | New season announcement |

---

## Team Portraits

Pattern: `sparq_team_{person-name}.{ext}`

| Example | Description |
|---|---|
| `sparq_team_tony-dye.png` | Tony Dye headshot/portrait |
| `sparq_team_craig-alexander.svg` | Craig Alexander illustration |

---

## Product UI Screenshots

Pattern: `sparq_product_{product-name}.{ext}`

| Example | Description |
|---|---|
| `sparq_product_sparqmake-pipeline-monitor.png` | SparqMake pipeline UI |
| `sparq_product_sparqdashboard-command-center.png` | Dashboard command center |

---

## Brand Reference

Pattern: `ref_brand_{description}.{ext}`

| Example | Description |
|---|---|
| `ref_brand_sparq-brand-colors.jpeg` | Brand color palette |
| `ref_brand_sparq-identity-guide-page_01.png` | Brand identity guide page |

---

## Renders (Non-Character)

The keyword **"render"** triggers `subject_reference` classification with `primary_subject` generation role. Use for 3D arena renders, environment art, and concept art that does not feature a character as the primary subject.

Pattern: `ref_render_{description}_{number}.{ext}`

| Example | Description |
|---|---|
| `ref_render_stadium-overview_01.png` | Stadium aerial render |
| `ref_render_arena-obstacle-course_01.png` | Arena course overview |

---

## Mockups & Screenshots

The keyword **"screenshot"** triggers `subject_reference` classification.

Pattern: `ref_{type}_{description}_{number}.{ext}`

Where `{type}` is one of: `screenshot`, `mockup`, `gameplay`, `concept`

| Example | Description |
|---|---|
| `ref_screenshot_character-select.png` | In-game character select screen |
| `ref_mockup_phone-title-screen.png` | Phone mockup of title screen |
| `ref_gameplay_speed-match.png` | Speed Match gameplay capture |
| `ref_concept_arena-design.png` | Arena concept art |

---

## Investor Materials

Pattern: `ref_deck-slide_{description}_{number}.{ext}`

| Example | Description |
|---|---|
| `ref_deck-slide_sparq-ecosystem-v1.6_01.jpeg` | Investor deck slide 1 |

### Trailer Assets

Pattern: `ref_trailer_{scene}_{description}_{variant}.{ext}`

| Example | Description |
|---|---|
| `ref_trailer_01_hero_crowd.png` | Trailer scene 1, hero shot with crowd |

---

## Sound Assets

Pattern: `{type}_{description}.{ext}` where type is one of: `sfx`, `music`, `voice`, `podcast`

## Fonts

Pattern: `font_{family}_{weight}.{ext}` (e.g., `font_montserrat_bold.woff2`)

---

## Quick Reference: Keywords & Auto-Classification

Include these keywords in your filename to trigger automatic classification when uploaded to SparqMake:

| Keyword | Asset Class | Gen. Role | Example |
|---------|------------|-----------|---------|
| `logo` | compositing | compositing_logo | `sparq_logo_skull_red.svg` |
| `char` / `character` | subject_reference | primary_subject | `crownu_char_male_lsu_football.png` |
| `background` | style_reference | supporting | `style_background_grunge_dark.png` |
| `mood` / `style` | style_reference | supporting | `style_reference_sports-graphic_michigan.jpg` |
| `screenshot` | subject_reference | supporting | `ref_screenshot_arena_01.png` |
| `render` | subject_reference | primary_subject | `ref_render_stadium_01.png` |
| `gameplay` | subject_reference | supporting | `ref_gameplay_dunk_01.png` |
| (none) | subject_reference | (default) | `sparq_promo_banner_01.png` |

---

## Auto-Detected Metadata (via Backfill)

In addition to asset class and generation role, SparqMake's backfill service auto-detects these Intelligence fields from your filename:

| Field | How It's Detected |
|---|---|
| **Franchise** | `crownu_` → Crown U, `rumbleu_` → Rumble U, `mascotmayhem_` → Mascot Mayhem, `sparq_` → Sparq |
| **Conflict Tags** | School name extracted from university character filenames (e.g., `crownu_char_male_georgia_*` → conflict tag `georgia`) |
| **Brand Layer** | `sparq_logo_` → primary_logo, `crownu/rumbleu/mascotmayhem_logo_` → secondary_mark, `uni_logo_`/`partner_logo_` → partner |
| **Generation Allowed** | `true` for all assets except logos (`false`) |
| **Compositing Only** | `true` for logos, `false` for everything else |
| **Default Scores** | Characters: identity=4, style=2. Logos: identity=5, style=1. Style refs: identity=2, style=4 |

### Fields That Still Require Manual Input

- **Approved Channels** — which platforms the asset can be published to (twitter, instagram_feed, instagram_story, linkedin)
- **Approved Templates** — which SparqMake templates can use this asset
- **Score Overrides** — adjust the default scores if the auto-detected values don't fit

---

## Changelog

**v2.0 (April 2026)** — Major update reflecting conventions established during the media library renaming effort:
- Added logo-based character classification rule (classify by uniform logo, not color)
- Added standard pose vocabulary (8 terms)
- Added primary purpose rule and multi-subject rule
- Added new asset types: marketing/promo, team portraits, product UI, brand reference, renders, investor materials, trailer assets, style inspiration
- Added game brand logo patterns for Rumble U and Mascot Mayhem
- Added style inspiration categories (sports-graphic, branding, typography, ui, photography, illustration, layout)
- Added auto-detected metadata section (franchise, conflict tags, brand layer, scores)
- Removed "lab-coat" and "turnaround" from pose vocabulary

**v1.0 (March 2026)** — Initial version covering characters, logos, backgrounds, screenshots, sounds, and fonts.
