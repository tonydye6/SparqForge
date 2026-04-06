# SparqMake Backfill Service Enhancement Spec

## Problem

The backfill service at `artifacts/api-server/src/services/backfill-assets.ts` currently only auto-sets `assetClass` and `generationRole` from filename keywords. All other Asset Intelligence fields (Franchise, Conflict Tags, Brand Layer, Scores, etc.) must be manually configured per-image in the UI.

Since our filenames follow a structured naming convention, we can infer most Intelligence fields automatically.

## What To Change

Enhance the `backfillAssets()` function in `backfill-assets.ts` to extract additional metadata from the asset `name` field (which contains the filename).

### 1. Franchise Detection

Parse the filename prefix to set the `franchise` field:

| Prefix starts with | Franchise value |
|---|---|
| `crownu_` | `Crown U` |
| `rumbleu_` | `Rumble U` |
| `mascotmayhem_` | `Mascot Mayhem` |
| `sparq_` | `Sparq` |
| `uni_` | (leave null — university assets aren't franchise-specific) |
| `partner_` | (leave null) |
| `style_` | (leave null) |
| `ref_` | (leave null) |

### 2. Conflict Tags from School Names

For character files matching `crownu_char_{gender}_{school}_{sport}_{pose}`, extract the `{school}` segment and add it as a conflict tag. This prevents characters from different schools being used together.

Known school values: `alabama`, `duke`, `florida`, `fsu`, `georgia`, `iowa`, `kentucky`, `lsu`, `miami`, `michigan`, `notre-dame`, `oregon`, `penn-state`, `smu`, `texas`, `unc`, `utah`, `wisconsin`, `cal`, `nc-state`, `washington`

For Sparq-branded characters (where the 4th segment is a color like `blue`, `red-white`, etc.), do NOT add conflict tags — these are generic and can be used with any school.

How to distinguish: if the 4th segment of a `crownu_char_` filename matches a known school name → it's university-branded, add the school as a conflict tag. Otherwise → it's Sparq-branded, skip conflict tags.

### 3. Brand Layer for Logos

| Filename pattern | Brand Layer value |
|---|---|
| `sparq_logo_` | `primary_logo` |
| `crownu_logo_` | `secondary_mark` |
| `rumbleu_logo_` | `secondary_mark` |
| `mascotmayhem_logo_` | `secondary_mark` |
| `uni_logo_` | `partner` |
| `partner_logo_` | `partner` |

### 4. Default Scores by Asset Type

Set reasonable defaults based on asset classification:

| Asset Class | Subject Identity Score | Style Strength Score | Freshness Score |
|---|---|---|---|
| `subject_reference` (characters) | 4 | 2 | 3 |
| `compositing` (logos) | 5 | 1 | 3 |
| `style_reference` | 2 | 4 | 3 |
| Everything else | 3 | 3 | 3 |

### 5. Generation & Compositing Flags

These are partially handled already, but ensure:

| Asset Class | `generationAllowed` | `compositingOnly` | `approvedForCompositing` |
|---|---|---|---|
| `compositing` (logos) | `false` | `true` | `true` |
| `subject_reference` | `true` | `false` | `false` |
| `style_reference` | `true` | `false` | `false` |

### 6. Character Identity Note

For character files, auto-generate a character identity note from the filename segments:

Example: `crownu_char_male_georgia_football_default.png` →
`characterIdentityNote: "Male Georgia football character, default pose"`

Parse: `{gender} {school/colors} {sport} character, {pose} pose`

## Existing Keywords (no changes needed)

The current keyword detection is correct:
- `logo` → compositing / compositing_logo
- `char` or `character` → subject_reference / primary_subject
- `background` → style_reference / supporting
- `mood` or `style` → style_reference / supporting
- `screenshot` → subject_reference / supporting
- `render` → subject_reference / primary_subject
- `gameplay` → subject_reference / supporting

## Implementation Notes

- The backfill runs on ALL assets in the database when triggered via POST `/api/assets/backfill`
- Only update fields that are currently `null` — don't overwrite manually-set values
- The filename is stored in the `name` field of the assets table
- Conflict tags and approved channels are string arrays stored as comma-separated values
