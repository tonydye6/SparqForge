---
name: Gemini Interactions video param support
description: Public Gemini Interactions API rejects safety_settings, delivery, and 1:1 video aspect ratio with 400 errors; what video requests may contain.
---
# Gemini Interactions video request params

The public Gemini Interactions API (direct GEMINI_API_KEY) rejects several params on `interactions.create` for video with 400 errors:

- `safety_settings` — "not available on the Gemini API but it is available on the Gemini Enterprise Agent Platform"
- `delivery` — "Unknown parameter 'delivery'"
- `response_format.aspect_ratio: "1:1"` — only `16:9` and `9:16` are supported for video

**Why:** A user's image-to-video conversion failed live (2026-07-22) with each of these in sequence; each removal surfaced the next rejection.

**How to apply:** Video requests must only send model, input, response_format {type, aspect_ratio (16:9|9:16), duration}, previous_interaction_id. Normalize square/landscape ratios to 16:9 and portrait to 9:16. Response handling must accept inline base64 OR a URI fallback since delivery cannot be requested. Safety relies on model defaults plus prompt-level constraints ("Do not show people").
