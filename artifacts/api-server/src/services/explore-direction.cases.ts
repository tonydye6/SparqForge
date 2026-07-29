/**
 * Directed-prompt cases, shared by the vitest suite and the tsx runner.
 *
 * These are the invariants that decide whether the Creative Director's decision
 * actually survives the trip to the image model. The whole stage-03 fidelity bug
 * was a prompt-assembly failure, so assembling the prompt is the thing worth
 * pinning down: that the brand block arrives verbatim, that reference numbering
 * matches attach order, that a director-selected mark is not forbidden by our own
 * trailer, and that the axis directive cannot outrank the brand contract.
 */

import {
  buildDirectedPrompt,
  constraintTrailer,
  describeReferences,
  orderReferences,
  referenceRoleForDirectorRole,
  slotTypeForDirectorRole,
} from "./explore-direction.js";
import { mergeReferenceSlots, PERSONA_GUARANTEED_SLOTS } from "./creative-direction.js";
import type { ReferenceImage } from "./imagen.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const BUF = Buffer.from([0]);

const ref = (
  role: ReferenceImage["role"],
  description: string,
  extra: Partial<ReferenceImage> = {},
): ReferenceImage => ({
  imageBuffer: BUF,
  mimeType: "image/png",
  role,
  description,
  ...extra,
});

const CONTRACT = 'Brand colors: primary #3d348b.\nNever include: no non-Crown-U logos.';

export async function collectExploreDirectionCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------ role mapping
  check("director subject becomes a subject reference",
    referenceRoleForDirectorRole("subject") === "subject_reference");
  check("director style becomes a style reference",
    referenceRoleForDirectorRole("style") === "style_reference");
  check("a mark rides the subject lane, because imagen has no object lane",
    referenceRoleForDirectorRole("object") === "subject_reference");
  check("slot types keep the three director roles distinct",
    slotTypeForDirectorRole("subject") === "character" &&
    slotTypeForDirectorRole("style") === "style" &&
    slotTypeForDirectorRole("object") === "object");

  // ------------------------------------------------------------- the trailer
  check("with no mark attached, every mark is forbidden",
    /Do not render any logo/.test(constraintTrailer(false)));
  check("with a mark attached, the attached mark is permitted and others are not",
    /only brand mark permitted/.test(constraintTrailer(true)) &&
    /any other logo/.test(constraintTrailer(true)));
  check("the trailer always forbids rendered text, because stage 04 overlays it",
    /Do not include any text/.test(constraintTrailer(true)) &&
    /Do not include any text/.test(constraintTrailer(false)));
  /*
   * The regression this exists to prevent: the legacy trailer says "do not
   * render any logos" because that path composites the mark afterwards. Explore
   * composites nothing, so reusing that wording would have told the model to
   * omit the very logo the director had just selected.
   */
  check("a director-selected mark is never forbidden by our own trailer",
    !/Do not render any logo/.test(constraintTrailer(true)));

  // ------------------------------------------------------------- ref ordering
  const unordered = [
    ref("style_reference", "mood"),
    ref("subject_reference", "the character"),
    ref("style_reference", "more mood"),
    ref("subject_reference", "the mark, a logo"),
  ];
  const ordered = orderReferences(unordered);
  check("subjects are ordered before styles, matching what imagen attaches",
    ordered.slice(0, 2).every(r => r.role === "subject_reference") &&
    ordered.slice(2).every(r => r.role === "style_reference"));
  check("ordering keeps every reference", ordered.length === unordered.length);
  check("ordering is stable within a role", ordered[0]?.description === "the character");

  // --------------------------------------------------------- ref descriptions
  const described = describeReferences(ordered);
  check("descriptions are numbered from 1 in attach order",
    described.includes("Attached image 1: the character") &&
    described.includes("Attached image 2: the mark, a logo"));
  check("numbering matches the ORDERED list, not the caller's list", (() => {
    // Describing the unordered list would label the character as image 2.
    const wrong = describeReferences(unordered);
    return wrong.includes("Attached image 2: the character") &&
      described.includes("Attached image 1: the character");
  })());
  check("a style reference is described as mood, not as a subject",
    /Attached image 3 defines visual mood/.test(described), described);
  check("a persona sample is described as the designer's work sample",
    /work sample by the selected designer/.test(
      describeReferences([ref("style_reference", "by Ada", { source: "persona" })]),
    ));
  check("no references means no reference block at all", describeReferences([]) === "");

  // ------------------------------------------------------------- the assembly
  const prompt = buildDirectedPrompt({
    directorPrompt: "  A heroic key art piece of the tennis player.  ",
    styleContract: CONTRACT,
    overflowBlock: "\n\nADDITIONAL BRAND ASSET DESCRIPTORS:\n- extra",
    references: ordered,
    axisDirective: "shot from a low hero angle",
    hasMarkReference: true,
  });

  check("the director's prose leads the prompt",
    prompt.startsWith("A heroic key art piece"), prompt.slice(0, 40));
  check("the director's prose is trimmed, not padded", !prompt.startsWith(" "));
  check("the brand contract arrives VERBATIM, unparaphrased",
    prompt.includes(CONTRACT), prompt);
  check("the brand contract is labelled non-negotiable",
    prompt.includes("NON-NEGOTIABLE BRAND CONSTRAINTS:"));
  check("the axis directive is its own labelled block, per §1.17",
    prompt.includes("FOR THIS TAKE IN THE SPREAD: shot from a low hero angle."));
  /*
   * Ordering invariant with teeth: a spread explores composition, and a
   * per-take directive must never read as though it outranks the brand
   * contract. Directive before constraints is what guarantees that.
   */
  check("the axis directive sits BEFORE the brand constraints",
    prompt.indexOf("FOR THIS TAKE IN THE SPREAD") < prompt.indexOf("NON-NEGOTIABLE"),
    { directive: prompt.indexOf("FOR THIS TAKE IN THE SPREAD"), constraints: prompt.indexOf("NON-NEGOTIABLE") });
  check("reference descriptions come before the constraints they qualify",
    prompt.indexOf("REFERENCE IMAGES:") < prompt.indexOf("NON-NEGOTIABLE"));
  check("overflow descriptors survive into the prompt",
    prompt.includes("ADDITIONAL BRAND ASSET DESCRIPTORS"));
  check("the trailer is last, so nothing above can soften it",
    prompt.trimEnd().endsWith(constraintTrailer(true)), prompt.slice(-120));

  // ------------------------------------------------------- assembly, degraded
  const bare = buildDirectedPrompt({
    directorPrompt: "Just the direction.",
    styleContract: "",
    references: [],
  });
  check("an empty style contract produces no empty constraints heading",
    !bare.includes("NON-NEGOTIABLE"), bare);
  check("no axis directive produces no directive block",
    !bare.includes("FOR THIS TAKE"), bare);
  check("a bare prompt still carries the trailer", bare.includes("Do not include any text"));
  check("a bare prompt never leaves blank-line gaps", !/\n\n\n/.test(bare), bare);
  check("with nothing attached, marks are forbidden in the bare prompt",
    /Do not render any logo/.test(bare));

  check("hasMarkReference is inferred from descriptions when not passed", (() => {
    const inferred = buildDirectedPrompt({
      directorPrompt: "x".repeat(25),
      styleContract: "",
      references: [ref("subject_reference", "Brand asset \"Crown U Logo\". Reproduce this exact asset")],
    });
    return /only brand mark permitted/.test(inferred);
  })());

  // ------------------------------ the shared budgeting, now over ReferenceImage
  /*
   * mergeReferenceSlots was ImageSlot-only and is now generic. These assert the
   * priority contract still holds for the imagen shape, because the alternative
   * to sharing it was a second copy, and a second copy of asset budgeting is
   * precisely the mistake that produced this bug in the first place.
   */
  const withId = (id: string, role: ReferenceImage["role"] = "subject_reference"): ReferenceImage =>
    ref(role, id, { assetId: id });

  const merged = mergeReferenceSlots<ReferenceImage>({
    attached: [withId("attached")],
    director: [withId("d1"), withId("d2")],
    packet: [withId("p1")],
    persona: [withId("per1", "style_reference"), withId("per2", "style_reference")],
    cap: 6,
  });
  check("the merge is generic over the reference shape and keeps assetIds",
    merged.every(r => typeof r.assetId === "string"), merged.map(r => r.assetId));
  check("an attachment outranks the director",
    merged[0]?.assetId === "attached", merged.map(r => r.assetId));
  check("director selections outrank the packet",
    merged.findIndex(r => r.assetId === "d1") < merged.findIndex(r => r.assetId === "p1"),
    merged.map(r => r.assetId));
  check("the persona keeps its guaranteed slots when there is room",
    merged.filter(r => r.assetId?.startsWith("per")).length >= PERSONA_GUARANTEED_SLOTS,
    merged.map(r => r.assetId));
  check("the merge never exceeds the cap", (() => {
    const tight = mergeReferenceSlots<ReferenceImage>({
      attached: [withId("a1"), withId("a2")],
      director: [withId("d1"), withId("d2"), withId("d3")],
      packet: [withId("p1"), withId("p2")],
      persona: [withId("per1"), withId("per2")],
      cap: 3,
    });
    return tight.length === 3;
  })());
  check("duplicate assetIds are dropped so one asset never eats two slots", (() => {
    const dupes = mergeReferenceSlots<ReferenceImage>({
      attached: [withId("same")],
      director: [withId("same")],
      packet: [withId("same")],
      persona: [],
      cap: 6,
    });
    return dupes.length === 1;
  })());
  check("a reference with no assetId is never treated as a duplicate", (() => {
    const anon = mergeReferenceSlots<ReferenceImage>({
      attached: [ref("subject_reference", "one"), ref("subject_reference", "two")],
      packet: [],
      persona: [],
      cap: 6,
    });
    return anon.length === 2;
  })());

  return cases;
}
