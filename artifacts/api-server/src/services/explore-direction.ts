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

/**
 * The identity lock, and why it comes FIRST.
 *
 * Tony's verdict on the first real spread was "a serious loss of identity in
 * each of the images. I want the EXACT character." The mechanism was visible in
 * the director's own output: it wrote "the subject is a dark-skinned athlete
 * with voluminous curly hair, wearing her signature white kit", roughly 200
 * words of prose describing a person whose actual picture was attached. A
 * renderer given a long description first and a photograph second generates the
 * description and treats the photograph as mood. The description is a lossy
 * re-encoding of a face, and a lossy re-encoding IS the identity loss.
 *
 * Crown U's brand record already carries the correct instruction — "using the
 * uploaded reference image as the EXACT character, do not alter the character's
 * appearance, outfit, proportions, or design in any way" — but it sat fourth of
 * six blocks, behind all that prose. Position was doing more work than wording.
 *
 * So the lock leads, and it says explicitly that it beats anything below it,
 * because something below it WILL eventually contradict it. DIRECTOR_SYSTEM was
 * changed in the same pass to stop describing subjects at all; this block is the
 * belt to that braces, since the director is a model and will sometimes do it
 * anyway.
 *
 * It is emitted only when a subject reference is actually attached. Claiming an
 * exact character when no picture of one is present would be a lie to the
 * renderer, and it would suppress the invention we DO want in that case.
 */
export function identityLock(subjectCount: number, markPresent: boolean): string {
  if (subjectCount < 1) return "";
  const which = subjectCount === 1 ? "Attached image 1 is" : `Attached images 1 to ${subjectCount} are`;
  return (
    `IDENTITY LOCK. This overrides every description below it.\n` +
    `${which} the EXACT character to render, not a reference for a similar one. ` +
    `Reproduce the face and facial structure, skin tone, hairstyle and hair colour, body proportions, and the uniform's design, colours and markings exactly as they appear in the attached image. ` +
    `It is the same individual, re-posed and re-lit for this scene. ` +
    `Change only pose, camera angle, lighting, background and environment. ` +
    `If any wording below describes this character's appearance differently, the attached image wins and the wording is to be ignored.` +
    (markPresent
      ? `\nThe character's own uniform markings are part of that identity and are reproduced as shown. A separately attached brand mark may be placed in the scene, but never by redesigning the character's kit.`
      : "")
  );
}

/**
 * How many of the attached references, counting from the front, are the
 * identity-critical subject.
 *
 * A COUNT alone is not enough for the lock to be truthful, because the lock says
 * "attached image 1 is the exact character" and slot merging can put a manual
 * attachment or a style-profile reference ahead of the director's picks. So this
 * counts the LEADING RUN only: if anything that is not a locked subject appears
 * first, the run is zero and no lock is emitted. Under-claiming costs fidelity;
 * over-claiming tells the renderer to grow a face out of a logo.
 */
export function leadingSubjectRun(
  references: ReferenceImage[],
  subjectAssetIds: Set<string>,
): number {
  let n = 0;
  for (const ref of references) {
    if (ref.assetId && subjectAssetIds.has(ref.assetId)) n++;
    else break;
  }
  return n;
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
  /**
   * How many attached references are the subject whose identity must hold.
   * Drives the identity lock; 0 means invent the subject freely.
   */
  subjectReferenceCount?: number;
}

/**
 * The final prompt for one take.
 *
 * Order is load-bearing:
 *   1. the IDENTITY LOCK, when a subject reference is attached, because
 *      position beat wording on the first real spread
 *   2. the director's prose, which is the direction
 *   3. the reference roll-call, so "attached image 2" resolves
 *   4. the axis directive, this take's only difference from its siblings
 *   5. the VERBATIM brand constraints, unparaphrased
 *   6. overflow descriptors for selections that missed the slot cap
 *   7. the non-negotiable trailer
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

  // Defaults to 0, i.e. NO lock, when the caller does not say. A caller that
  // forgets loses fidelity; a caller that guesses could point the lock at a
  // logo, and only one of those two failures produces a face grown from a
  // wordmark. Callers compute this with leadingSubjectRun.
  const subjectCount = input.subjectReferenceCount ?? 0;

  const parts = [
    identityLock(subjectCount, hasMarkReference),
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
): Promise<{ references: ReferenceImage[]; hasMark: boolean; subjectCount: number; loadedAssetIds: string[] }> {
  const references: ReferenceImage[] = [];
  const loadedAssetIds: string[] = [];
  let hasMark = false;
  let subjectCount = 0;

  /*
   * Subjects first, then marks, then styles.
   *
   * imagen has two reference lanes, so a mark rides the subject lane and would
   * otherwise be numbered among the characters. The identity lock says
   * "attached image 1 is the EXACT character", so if a logo landed at position 1
   * the lock would point at the wrong picture and instruct the renderer to grow
   * a face from a wordmark. Ordering here is what makes that sentence true.
   */
  const rank = { subject: 0, object: 1, style: 2 } as const;
  const ordered = [...selections].sort((a, b) => rank[a.role] - rank[b.role]);

  for (const sel of ordered) {
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
    if (sel.role === "subject") subjectCount++;
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

  return { references, hasMark, subjectCount, loadedAssetIds };
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
