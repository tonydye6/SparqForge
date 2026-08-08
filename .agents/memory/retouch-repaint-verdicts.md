---
name: Retouch repaint verdicts
description: Which asset types survive AI spot-removal retouch vs get fully repainted
---
The trademark retouch (Gemini image edit, "change only these small areas" instruction) splits sharply by image complexity, not by mark count:
- Single-character studio portraits (crownu_char_* style) mostly come back CLEAN, 0.6–4% frame change.
- Multi-figure scenes, UI screenshots, reference/concept boards, and the sparq_branded_* character sheets come back REPAINTED (34–97% change) almost every time — the model regenerates the whole picture.

**Why:** first full 46-asset wave: 16 CLEAN / 30 REPAINTED; every ref_concept/ref_screenshot/sparq_branded asset repainted. The --apply guard correctly refused all repaints.
**Caveat (likely measurement artifact):** many "repaints" are transparent-background RGBA PNGs (sparq_branded_* are ~63–73% transparent) scored against the model's opaque JPEG output — every background pixel counts as changed, mechanically producing ~95%. Verdicts on cut-out PNGs are unreliable until the diff is masked to the original's opaque region (proposed as a follow-up task).
**How to apply:** don't trust REPAINTED verdicts on alpha-heavy PNG originals; check `identify` alpha first. Opaque multi-figure scenes/boards may still be genuine repaints. Complex assets need a different approach (crop-and-inpaint or manual). Also: retouch outputs are JPEG bytes even when named .png, and land in the auth-gated brand-assets namespace (not externally fetchable without copying to generated/).
