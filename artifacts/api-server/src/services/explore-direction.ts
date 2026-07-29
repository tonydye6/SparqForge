/**
 * Stage 03 · Image · assembling a directed prompt for one Explore take.
 *
 * WHY THIS FILE EXISTS, since a previous version of this stage is the reason the
 * whole v2 fidelity bug happened:
 *
 * `imagen.ts buildImagePrompt` is the LEGACY prompt assembler. It takes an
 * AssembledContext and re-derives all its steering from it, which means it can
 * only ever compose the prompt itself. Explore copied that path wholesale and so
 * never called the Creative Director, the machinery written in July specifically
 * to fix "the model is not using the asset library". A third generation stack
 * reintroduced the exact failure v2 existed to fix (25_GENERATION_ARCHITECTURE).
 *
 * The Director's output is prose plus asset selections, so it needs an assembler
 * that treats the prompt as an INPUT rather than something to derive. That is all
 * this file is. It deliberately does NOT re-implement asset selection,
 * eligibility, slot budgeting or the image call: those are
 * `creative-direction.ts` (buildAssetCatalog / buildCreativeDirection /
 * mergeReferenceSlots / buildOverflowDescriptors) and
 * `imagen.ts generateImageFromPrompt`, shared with the Co-pilot.
 *
 * Everything except `loadDirectedReferences` is pure and verifiable on a machine
 * that cannot start vitest.
 */

import type { Asset } from "@workspace/db";
import type { ReferenceImage } from "./imagen.js";
import type { DirectorAssetSelection } from "./creative-direction.js";
import { slotDescriptionForAsset } from "./creative-direction.js";
import { axisDirectiveBlock } from "./explore-run.js";
import { resolveUrl, readBuffer, contentTypeFor } from "./storage.js";

/**
 * Map a director role to an imagen reference role.
 *
 * ReferenceImage has only two roles, so "object" (a brand mark that must be
 * reproduced exactly) rides in the subject lane. That is correct for ordering
 * and for the cap, and the per-reference DESCRIPTION is what tells the model a
 * mark is a mark, which is why the description is generated from the asset via
 * the shared slotDescriptionForAsset rather than from the role alone.
 */
export function referenceRoleForDirectorRole(
  role: DirectorAssetSelection["role"],
): ReferenceImage["role"] {
  return role === "style" ? "style_reference" : "subject_reference";
}

/** The slot type slotDescriptionForAsset expects, from a director role. */
export function slotTypeForDirectorRole(
  role: DirectorAssetSelection["role"],
): "character" | "style" | "object" {
  if (role === "subject") return "character";
  if (role === "style") return "style";
  return "object";
}

/**
 * Per-reference descriptions, numbered to match attach order.
 *
 * The numbering has to be computed from the SAME ordered list the image call
 * attaches, or every description points at the wrong picture. `imagen.ts` orders
 * subject references before style references, so callers must pass the list in
 * that order; `orderReferences` below is the one place that ordering is applied.
 */
export function describeReferences(references: ReferenceImage[]): string {
  if (references.length === 0) return "";
  const lines = references.map((ref, i) => {
    const n = `Attached image ${i + 1}`;
    if (ref.source === "persona") {
      return `${n} is a work sample by the selected designer. Study its composition, layout structure, color treatment and texture; the result must read as this designer's work.${ref.description ? ` ${ref.description}` : ""}`;
    }
    if (ref.role === "style_reference") {
      return `${n} defines visual mood and treatment to emulate.${ref.description ? ` ${ref.description}` : ""}`;
    }
    return `${n}: ${ref.description || "a subject that must remain recognizable."}`;
  });
  return `REFERENCE IMAGES:\n${lines.join("\n")}`;
}

/**
 * Subject references before style references, matching what the image call
 * attaches. Exported so the caller can build descriptions from the identical
 * list rather than a parallel one that might diverge.
 */
export function orderReferences(references: ReferenceImage[]): ReferenceImage[] {
  return [
    ...references.filter(r => r.role === "subject_reference"),
    ...references.filter(r => r.role === "style_reference"),
  ];
}

/**
 * What the model must not do, regardless of anything above.
 *
 * Text is excluded because stage 04 composites the hook and the caption as live
 * layers over the picture (`headlineRenderMode: "overlay"`), so rendered
 * lettering is not just off-style, it is unfixable without paying for the image
 * again.
 *
 * Marks are handled differently from the legacy trailer, and the difference is
 * deliberate. Legacy says "do not render any logos" because that path
 * composites the mark afterwards. Explore composites nothing, so a blanket
 * prohibition would silently discard a mark the Director explicitly selected —
 * the director would be choosing the brand's logo and the prompt would be
 * telling the model to leave it out. So: no marks unless one was attached, and
 * when one was, that attached mark only.
 */
export function constraintTrailer(hasMarkReference: boolean): string {
  const base =
    "Do not include any text, words, letters or numbers in the image: headlines and captions are composited as separate layers afterwards.";
  return hasMarkReference
    ? `${base} The only brand mark permitted in the image is the one supplied as an attached reference, reproduced exactly as shown. Do not invent, redraw or add any other logo, wordmark or watermark.`
    : `${base} Do not render any logo, brand mark, wordmark or watermark.`;
}

export interface DirectedPromptInput {
  /** The Creative Director's prose. Leads, because it is the direction. */
  directorPrompt: string;
  /** buildSessionStyleContract output, appended VERBATIM. */
  styleContract: string;
  /** buildOverflowDescriptors output for selections that missed the cap. */
  overflowBlock?: string;
  /** The references actually attached, already ordered by orderReferences. */
  references: ReferenceImage[];
  /** This take's axis directive, e.g. "shot from a low hero angle". */
  axisDirective?: string;
  /** True when any attached reference is a brand mark. */
  hasMarkReference?: boolean;
}

/**
 * The final prompt for one take.
 *
 * Order is load-bearing:
 *   1. the director's prose, because it is the direction
 *   2. the reference roll-call, so "attached image 2" resolves
 *   3. the axis directive, this take's only difference from its siblings
 *   4. the VERBATIM brand constraints, unparaphrased
 *   5. overflow descriptors for selections that missed the slot cap
 *   6. the non-negotiable trailer
 *
 * The constraint block is appended verbatim rather than folded into the
 * director's prose for the reason the Co-pilot does the same: a model asked to
 * restate brand rules launders them, and laundered rules are how a Crown U post
 * ends up off palette. The axis directive sits BEFORE the constraints so that a
 * spread can explore composition without a directive ever appearing to outrank
 * the brand contract.
 */
export function buildDirectedPrompt(input: DirectedPromptInput): string {
  const { directorPrompt, styleContract, overflowBlock, references, axisDirective } = input;

  const hasMarkReference =
    input.hasMarkReference ??
    references.some(r => /\bmark\b|\blogo\b|wordmark/i.test(r.description || ""));

  const parts = [
    directorPrompt.trim(),
    describeReferences(references),
    axisDirective && axisDirective.trim() ? axisDirectiveBlock(axisDirective.trim()) : "",
    styleContract.trim() ? `NON-NEGOTIABLE BRAND CONSTRAINTS:\n${styleContract.trim()}` : "",
    (overflowBlock || "").trim(),
    constraintTrailer(hasMarkReference),
  ];

  return parts.filter(p => p.length > 0).join("\n\n");
}

/**
 * Load the image files for the Director's selections, in the order it chose.
 *
 * The byId map is brand-scoped by construction (buildAssetCatalog queries one
 * brand), so a selection cannot reach across brands. A selection whose file
 * cannot be read is SKIPPED rather than thrown: losing one reference makes a
 * worse picture, while throwing would lose a spread the user has paid for.
 */
export async function loadDirectedReferences(
  selections: DirectorAssetSelection[],
  byId: Map<string, Asset>,
): Promise<{ references: ReferenceImage[]; hasMark: boolean; loadedAssetIds: string[] }> {
  const references: ReferenceImage[] = [];
  const loadedAssetIds: string[] = [];
  let hasMark = false;

  for (const sel of selections) {
    const asset = byId.get(sel.assetId);
    if (!asset?.fileUrl) continue;
    const loc = resolveUrl(asset.fileUrl);
    if (!loc) continue;
    const mime = asset.mimeType || contentTypeFor(loc.filename);
    if (!mime.startsWith("image/")) continue;
    const buffer = await readBuffer(loc);
    if (!buffer) {
      console.warn(`Director-selected asset ${asset.id} (${asset.name}) could not be read; skipping`);
      continue;
    }
    const slotType = slotTypeForDirectorRole(sel.role);
    if (slotType === "object") hasMark = true;
    references.push({
      imageBuffer: buffer,
      mimeType: mime,
      role: referenceRoleForDirectorRole(sel.role),
      source: "packet",
      assetId: asset.id,
      description: slotDescriptionForAsset(asset, slotType),
    });
    loadedAssetIds.push(asset.id);
  }

  return { references, hasMark, loadedAssetIds };
}

/**
 * Load explicit asset ids as references: a style profile's chosen reference
 * images, or assets a deep link put on the creative.
 *
 * Kept as a direct id load rather than going through buildGenerationPacket,
 * which is what let the template requirement go away entirely. These are human
 * choices, so they enter as the packet tier and outrank persona samples but not
 * the director.
 */
export async function loadAssetIdReferences(
  assets: Asset[],
  role: ReferenceImage["role"],
): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = [];
  for (const asset of assets) {
    if (!asset.fileUrl) continue;
    const loc = resolveUrl(asset.fileUrl);
    if (!loc) continue;
    const mime = asset.mimeType || contentTypeFor(loc.filename);
    if (!mime.startsWith("image/")) continue;
    const buffer = await readBuffer(loc);
    if (!buffer) continue;
    out.push({
      imageBuffer: buffer,
      mimeType: mime,
      role,
      source: "packet",
      assetId: asset.id,
      description: slotDescriptionForAsset(asset, role === "style_reference" ? "style" : "character"),
    });
  }
  return out;
}
