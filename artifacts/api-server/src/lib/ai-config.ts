export const AI_MODELS = {
  CLAUDE_SONNET: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  GEMINI_FLASH_IMAGE: process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image",
  GEMINI_FLASH_TEXT: process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash",
  VEO_VIDEO: process.env.VEO_MODEL || "gemini-omni-flash-preview",
} as const;

// Co-pilot Studio model pins — env-overridable; defaults derive from AI_MODELS so there
// is one source of truth for each model family.
//
// REGISTRY MAP (two config keys can address the same physical model with
// SEPARATE env overrides — overriding one does not move the other):
//   image:  AI_MODELS.GEMINI_FLASH_IMAGE (env GEMINI_IMAGE_MODEL) drives the batch
//           path (imagen.ts: generate/outpaint/cutout/headline); COPILOT_MODELS.
//           NANO_BANANA_MODEL (env NANO_BANANA_MODEL) drives Studio turns.
//   video:  AI_MODELS.VEO_VIDEO (env VEO_MODEL) drives batch video; COPILOT_MODELS.
//           OMNI_VIDEO_MODEL (env OMNI_VIDEO_MODEL) drives Studio video turns.
//   text:   AI_MODELS.GEMINI_FLASH_TEXT (env GEMINI_TEXT_MODEL) drives analysis and
//           design-spec; ART_DIRECTION_MODEL / QA_MODEL pin the Studio director + QA.
// Naming caveat: GEMINI_FLASH_IMAGE currently defaults to a Pro-tier image model
// and VEO_VIDEO to an Omni model — the constant names are historical.
// All Gemini targets require direct GEMINI_API_KEY (proxy does not support them).
// NANO_BANANA_MODEL / OMNI_VIDEO_MODEL: must be called via the Interactions API
// (ai.interactions.create), NOT ai.models.generateContent.
// ART_DIRECTION_MODEL / QA_MODEL: standard generateContent is fine.
export const COPILOT_MODELS = {
  NANO_BANANA_MODEL: process.env.NANO_BANANA_MODEL || AI_MODELS.GEMINI_FLASH_IMAGE,
  OMNI_VIDEO_MODEL: process.env.OMNI_VIDEO_MODEL || AI_MODELS.VEO_VIDEO,
  ART_DIRECTION_MODEL: process.env.ART_DIRECTION_MODEL || AI_MODELS.GEMINI_FLASH_TEXT,
  QA_MODEL: process.env.QA_MODEL || AI_MODELS.GEMINI_FLASH_TEXT,
} as const;

/**
 * Per-call cost constants. **Every default below was re-derived from the live
 * vendor price lists on 2026-08-08**, because two of them were fossils of models
 * this app no longer calls, in opposite directions:
 *
 *  - `IMAGEN_PER_IMAGE_USD` was `0.06` — exactly Imagen 4 Ultra's per-image
 *    price. The image model was repointed to `gemini-3-pro-image` (Task #209)
 *    and the constant never followed. Pro image output is $120/M tokens, 1120
 *    tokens for a 1K/2K image = **$0.134**. Every recorded image cost was
 *    understating real spend by ~2.2x, and the daily budget gate — which sums
 *    these same numbers — was letting through more than twice its threshold.
 *  - `VIDEO_COST_PER_SECOND_USD` was `0.42`, ≈ Veo 3 Standard's $0.40/s. The
 *    video model is now `gemini-omni-flash-preview` at **$0.10/s**, so video
 *    was OVERstated ~4.2x and the gate was over-conservative there.
 *
 * The text and caption figures are flat per-call approximations of token-priced
 * models, so they are order-of-magnitude by construction; both were low against
 * a typical call and are nudged toward observed shapes. `cost_logs.pricingBasis`
 * (M2) is what records that they remain estimates rather than measurements.
 *
 * Sources: ai.google.dev/gemini-api/docs/pricing · Anthropic model pricing.
 * KEEP THIS COMMENT UPDATED WHEN A MODEL IS REPOINTED — the fossils above are
 * what happens when the model moves and the price does not.
 */
export const COST_ESTIMATES = {
  /** claude-sonnet-4-6 at $3/M in, $15/M out; ~2k in + ~500 out per caption set. */
  CLAUDE_CAPTION_USD: Number(process.env.CLAUDE_CAPTION_COST_USD) || 0.0135,
  /** gemini-3-pro-image, 1K/2K output. 4K is $0.24 — not modelled separately yet. */
  IMAGEN_PER_IMAGE_USD: Number(process.env.IMAGEN_PER_IMAGE_COST_USD) || 0.134,
  /** gemini-3.5-flash at $1.50/M in, $9/M out; ~1k in + ~300 out per call. */
  GEMINI_TEXT_USD: Number(process.env.GEMINI_TEXT_COST_USD) || 0.004,
  /** 6s clip (the hard-coded duration) at the per-second rate below. */
  VIDEO_GENERATION_USD: Number(process.env.VIDEO_GENERATION_COST_USD) || 0.60,
  /** gemini-omni-flash-preview: 5792 tokens/s of 720p at $17.50/M ≈ $0.10/s. */
  VIDEO_COST_PER_SECOND_USD: Number(process.env.VIDEO_COST_PER_SECOND_USD) || 0.10,
} as const;

/**
 * Cheaper image tiers, verified available on 2026-08-08. These are what make the
 * Phase 7 two-pass spread worth building: previewing at flash-lite and rendering
 * the keep at pro costs **$0.40 for a spread of 8 plus one full render**, against
 * **$1.07** for eight pro renders today.
 *
 * Not yet wired to a call site — two-pass is unbuilt, and a constant that claims
 * a tier the code never selects would be a lie about what a spread costs.
 */
export const IMAGE_TIER_USD = {
  /** gemini-3.1-flash-lite-image, 1K. 4.0x cheaper than pro. */
  FLASH_LITE_1K: 0.0336,
  /** gemini-3.1-flash-image at 0.5K / 1K / 2K. */
  FLASH_0_5K: 0.045,
  FLASH_1K: 0.067,
  FLASH_2K: 0.101,
  /** gemini-3-pro-image, the model in use today. */
  PRO_1K_2K: 0.134,
  PRO_4K: 0.24,
} as const;

/**
 * Estimate video clip duration in seconds from compressed buffer size.
 * Uses ~500 KB/s as a conservative compressed video bitrate.
 * Clamps to a minimum of 3s (shortest meaningful clip).
 */
export function estimateVideoDurationSeconds(bufferBytes: number): number {
  return Math.max(3, Math.round(bufferBytes / 512_000));
}

export function estimateClaudeCost(): number {
  return COST_ESTIMATES.CLAUDE_CAPTION_USD;
}

export function estimateImagenCost(imageCount: number): number {
  return imageCount * COST_ESTIMATES.IMAGEN_PER_IMAGE_USD;
}

export function estimateGeminiTextCost(): number {
  return COST_ESTIMATES.GEMINI_TEXT_USD;
}
