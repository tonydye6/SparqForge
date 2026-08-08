---
name: Retouch repaint verdicts
description: Which asset types survive AI spot-removal retouch vs get fully repainted
---
The trademark retouch (Gemini image edit, "change only these small areas" instruction) splits sharply by image complexity, not by mark count:
- Single-character studio portraits (crownu_char_* style) mostly come back CLEAN, 0.6–4% frame change.
- Multi-figure scenes, UI screenshots, reference/concept boards, and the sparq_branded_* character sheets come back REPAINTED (34–97% change) almost every time — the model regenerates the whole picture.

**Why:** first full 46-asset wave: 16 CLEAN / 30 REPAINTED; every ref_concept/ref_screenshot/sparq_branded asset repainted. The --apply guard correctly refused all repaints.
**How to apply:** expect ~2/3 repaint rate on mixed libraries; don't treat a high REPAINTED count as a script bug. Complex assets need a different approach (crop-and-inpaint or manual). Also: retouch outputs are JPEG bytes even when named .png, and land in the auth-gated brand-assets namespace (not externally fetchable without copying to generated/).
