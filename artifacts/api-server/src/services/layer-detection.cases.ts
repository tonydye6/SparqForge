/**
 * Assertions for finding where a layer is.
 *
 * The ones that matter are the rules the PROMPT already asks for and the model
 * ignores anyway — every probe run returned a whole-frame row after being told
 * not to — plus the attribution refusals, because a wrong match puts the wrong
 * file behind a layer and 5c hands that file to a generative edit.
 */
import {
  attributeToCast,
  detectionSummary,
  layerEditRefusal,
  layerMoveSentence,
  layerPromptReference,
  layerScopeSentence,
  markLayerSlotDescription,
  nameOverlap,
  normalizeDetected,
  shouldCarryLayers,
  unionBox,
  BROAD_AREA,
  FULL_FRAME_AREA,
  MAX_LAYERS,
} from "./layer-detection.js";
import type { TakeLayer } from "./take-layers.js";

/** [ymin, xmin, ymax, xmax] in 0..1000, as Gemini returns it. */
const row = (name: string, role: string, box: [number, number, number, number]) =>
  ({ name, role, box_2d: box });

/** The two cast layers the demo post actually has, plus its base. */
const CAST: TakeLayer[] = [
  {
    key: "base", name: "Base", kind: "base", origin: "known_cast", assetId: "backdrop",
    assetName: "sparq_promo_phone_wp.png", thumbnailUrl: null,
    bbox: { x: 0, y: 0, w: 1, h: 1 }, pinned: false, note: null,
  },
  {
    key: "cast:char", name: "Crown U Tennis Athlete", kind: "subject", origin: "inherited_cast",
    assetId: "char", assetName: "crownu_char_female_blue_tennis_default.jpeg", thumbnailUrl: null,
    bbox: null, pinned: true, note: null,
  },
  {
    key: "cast:mark", name: "Crown U Mark", kind: "mark", origin: "inherited_cast",
    assetId: "mark", assetName: "Crown-U_Mark_Gold.png", thumbnailUrl: null,
    bbox: null, pinned: false, note: null,
  },
];

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- the box conversion, against real probe output ----
  /* The steered run's actual mark row: [88, 93, 204, 256] → x .093 y .088 w .163 h .116 */
  const mark = normalizeDetected([row("Crown U Mark", "mark", [88, 93, 204, 256])])[0];
  check("ymin/xmin/ymax/xmax is read in Gemini's order", !!mark && Math.abs(mark.bbox.x - 0.093) < 0.001 && Math.abs(mark.bbox.y - 0.088) < 0.001, mark?.bbox);
  check("width and height come from the far edges", !!mark && Math.abs(mark.bbox.w - 0.163) < 0.001 && Math.abs(mark.bbox.h - 0.116) < 0.001, mark?.bbox);
  check("a tight box is not flagged broad", mark?.broad === false);

  // ---- the rules the prompt cannot enforce ----
  check(
    "a whole-frame row is dropped however it is labelled",
    normalizeDetected([
      row("Background", "background", [0, 0, 1000, 1000]),
      row("Background Canvas", "device", [0, 0, 1000, 1000]),
      row("Background Panel", "object", [0, 0, 1000, 1000]),
    ]).length === 0,
  );
  check(
    "a near-whole-frame row is dropped too",
    normalizeDetected([row("Almost Everything", "device", [0, 0, 980, 990])]).length === 0,
  );
  check(
    "the frame border survives, because it is a real element",
    /* the blind run's actual row: [31, 35, 966, 967] → area 0.872, under the gate */
    normalizeDetected([row("Inner Border Frame", "device", [31, 35, 966, 967])]).length === 1,
  );
  check(
    "a big-but-real element is kept AND flagged broad",
    (() => {
      const d = normalizeDetected([row("Diagonal Slash Device", "device", [114, 0, 1000, 1000])]);
      return d.length === 1 && d[0].broad;
    })(),
  );
  check(
    "a background-kind row that is not whole-frame stops claiming to be the background",
    normalizeDetected([row("Diagonal Background Device", "background", [114, 0, 900, 1000])])[0]?.kind === "device",
  );
  check("a misclick-sized box is dropped", normalizeDetected([row("Speck", "object", [500, 500, 501, 501])]).length === 0);
  check("a malformed box is dropped, not repaired", normalizeDetected([row("Bad", "mark", [1, 2, 3] as never)]).length === 0);
  check("a nameless row is dropped", normalizeDetected([{ role: "mark", box_2d: [0, 0, 100, 100] }]).length === 0);
  check("an inverted box is dropped rather than flipped", normalizeDetected([row("Inverted", "mark", [800, 800, 100, 100])]).length === 0);
  check(
    "the same name twice is one layer",
    normalizeDetected([row("Crown U Mark", "mark", [88, 93, 204, 256]), row("crown u mark", "mark", [90, 95, 200, 250])]).length === 1,
  );
  check(
    "the list is capped",
    normalizeDetected(Array.from({ length: 20 }, (_, i) =>
      row(`Thing ${i}`, "object", [i * 10, 0, i * 10 + 50, 50]))).length === MAX_LAYERS,
  );
  check(
    "a wrapped {layers:[...]} response is read too",
    normalizeDetected({ layers: [row("Crown U Mark", "mark", [88, 93, 204, 256])] }).length === 1,
  );
  check("nothing detected is not an error", normalizeDetected([]).length === 0);
  check("the gates are ordered sensibly", BROAD_AREA < FULL_FRAME_AREA);

  // ---- attribution: the detected box wins, the cast's identity wins ----
  const detected = normalizeDetected([
    row("Inner Border Frame", "device", [31, 35, 966, 967]),
    row("Crown U Mark", "mark", [88, 93, 204, 256]),
    row("Female Tennis Player", "character", [160, 417, 953, 952]),
  ]);
  const attributed = attributeToCast(detected, CAST);
  check("every detected row survives attribution", attributed.length === 3);
  check(
    "the blind character name is upgraded to the cast's name",
    attributed[2].name === "Crown U Tennis Athlete" && attributed[2].assetId === "char",
    attributed[2],
  );
  check("the mark is matched to the real mark file", attributed[1].assetId === "mark" && attributed[1].matchedBy === "kind");
  check(
    "the detected BOX is kept, not the cast's absent one",
    Math.abs(attributed[2].bbox.x - 0.417) < 0.001 && Math.abs(attributed[1].bbox.x - 0.093) < 0.001,
  );
  check("an element with no cast behind it stays unattributed", attributed[0].assetId === null);
  check("the base is never a match target", !attributed.some(a => a.assetId === "backdrop"));
  check(
    "one cast member cannot be matched twice",
    (() => {
      const two = attributeToCast(
        normalizeDetected([
          row("Crown U Mark", "mark", [88, 93, 204, 256]),
          row("Crown U Mark Reflection", "mark", [600, 93, 700, 256]),
        ]),
        CAST,
      );
      return two.filter(t => t.assetId === "mark").length === 1;
    })(),
  );
  check(
    "two detected characters and one cast subject match NOTHING by kind",
    (() => {
      const amb = attributeToCast(
        normalizeDetected([
          row("Left Player", "character", [160, 100, 900, 400]),
          row("Right Player", "character", [160, 500, 900, 800]),
        ]),
        CAST,
      );
      return amb.every(a => a.matchedBy !== "kind");
    })(),
  );
  check(
    "an unrelated name is not matched on a weak overlap",
    attributeToCast(normalizeDetected([row("Rainbow Impact Burst", "object", [700, 400, 900, 650])]), CAST)[0].assetId === null,
  );

  // ---- name overlap ----
  check("identical names overlap fully", nameOverlap("Crown U Mark", "Crown U Mark") === 1);
  check("shared words score", nameOverlap("Crown U Tennis Athlete", "Crown U Tennis Player") >= 0.5);
  check("unrelated names do not", nameOverlap("Rainbow Burst", "Crown U Mark") === 0);
  check("short words carry no signal", nameOverlap("U", "U") === 0);

  // ---- the layer-scoped instruction (5c) ----
  const scoped = layerScopeSentence("Crown U Mark", "a small area in the upper left", "make it deeper gold");
  check(
    "the layer's NAME leads the scope, not its coordinates",
    scoped.startsWith("Change only the Crown U Mark — a small area in the upper left."),
    scoped,
  );
  check("the instruction is punctuated so it does not run into the guard", scoped.includes("deeper gold."));
  check(
    "everything else is held, and said in full rather than implied",
    scoped.includes("every other element and the background, stays exactly as it is"),
  );
  check(
    "an instruction that already ends in a stop is not double-punctuated",
    !layerScopeSentence("X", "there", "make it red.").includes("red.."),
  );
  check(
    "ragged whitespace in a typed instruction is collapsed",
    layerScopeSentence("X", "there", "make   it\n  red").includes("make it red."),
  );

  // ---- moving a layer ----
  const u = unionBox({ x: 0.093, y: 0.088, w: 0.163, h: 0.116 }, { x: 0.7, y: 0.8, w: 0.163, h: 0.116 });
  check("the union spans both places", Math.abs(u.x - 0.093) < 1e-9 && Math.abs(u.y - 0.088) < 1e-9);
  check(
    "the union reaches the far corner of the destination",
    Math.abs(u.x + u.w - 0.863) < 1e-9 && Math.abs(u.y + u.h - 0.916) < 1e-9,
    u,
  );
  check(
    "a union is clamped into the frame",
    (() => {
      const c = unionBox({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.9, y: 0.9, w: 0.3, h: 0.3 });
      return c.x === 0 && c.y === 0 && Math.abs(c.w - 1) < 1e-9 && Math.abs(c.h - 1) < 1e-9;
    })(),
  );
  check(
    "moving a layer onto itself is still a valid box",
    (() => {
      const same = unionBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
      return same.w > 0 && same.h > 0;
    })(),
  );

  const moved = layerMoveSentence("Crown U Mark", "a small area in the upper left", "a small area in the lower right");
  check("a move names the layer and both places", moved.includes("Move the Crown U Mark out of a small area in the upper left") && moved.includes("place it in a small area in the lower right"), moved);
  check("a move asks for the hole to be closed, or the model draws two copies", moved.includes("reconstruct whatever belongs behind it"));
  check("a move forbids a leftover duplicate by name", moved.includes("no trace or duplicate of it remains"));
  check("a move holds the size and everything else", moved.includes("at the same size"));
  check(
    "a typed extra rides along, punctuated",
    layerMoveSentence("X", "here", "there", "make it smaller").includes("make it smaller."),
  );

  /*
   * ---- STRICT MARKS ON THE LAYER PATH (doc 46 §1) ----
   *
   * These are the rule, not a preference. `creative-direction.ts:679` allows
   * prose to say "the brand mark in <asset name>" and nothing else about a mark,
   * because a mark described in words is a mark redrawn from words. The layer
   * path shipped naming the mark with no file attached, so the model copied it
   * out of the previous render — compounding, and one walked move came back at
   * 54% of the mark's width.
   */
  const MARK_LAYER = { name: "Crown U Mark", kind: "mark" };
  check(
    "a mark layer is referred to by its FILE, never by the layer's name",
    layerPromptReference({ ...MARK_LAYER, markAssetName: "Crown-U_Mark_Gold.png" })
      === "brand mark in Crown-U_Mark_Gold.png",
    layerPromptReference({ ...MARK_LAYER, markAssetName: "Crown-U_Mark_Gold.png" }),
  );
  check(
    "the mark's own name never reaches the prompt",
    !layerScopeSentence(
      layerPromptReference({ ...MARK_LAYER, markAssetName: "Crown-U_Mark_Gold.png" }),
      "a small area in the upper left",
      "make it bronze",
    ).includes("Crown U Mark"),
  );
  check(
    "a MOVE obeys the same rule — it is the sentence that asks for a redraw",
    layerMoveSentence(
      layerPromptReference({ ...MARK_LAYER, markAssetName: "Crown-U_Mark_Gold.png" }),
      "here", "there",
    ).startsWith("Move the brand mark in Crown-U_Mark_Gold.png out of"),
  );
  check(
    "anything that is not a mark keeps its own name — the naming is the feature",
    layerPromptReference({ name: "Crown U Tennis Athlete", kind: "character", markAssetName: "x.png" })
      === "Crown U Tennis Athlete",
  );
  check(
    "a mark with no file to attach is REFUSED rather than described",
    layerEditRefusal({ ...MARK_LAYER, hasMarkArtwork: false })?.includes("redrawing a trademark") === true,
    layerEditRefusal({ ...MARK_LAYER, hasMarkArtwork: false }),
  );
  check(
    "the refusal says which layer, so it is actionable",
    layerEditRefusal({ ...MARK_LAYER, hasMarkArtwork: false })?.startsWith("Crown U Mark is a brand mark") === true,
  );
  check(
    "and it says nothing was charged, because nothing was",
    layerEditRefusal({ ...MARK_LAYER, hasMarkArtwork: false })?.includes("Nothing was changed or charged") === true,
  );
  check(
    "a mark WITH its artwork proceeds",
    layerEditRefusal({ ...MARK_LAYER, hasMarkArtwork: true }) === null,
  );
  check(
    "only marks are gated — an unattributed sparkle is nobody's trademark",
    layerEditRefusal({ name: "Sparkle FX", kind: "element", hasMarkArtwork: false }) === null,
  );
  check(
    "the attached mark's description says to copy from the FILE, not from the render",
    markLayerSlotDescription("Crown-U_Mark_Gold.png").includes("from THIS file rather than from the image"),
    markLayerSlotDescription("Crown-U_Mark_Gold.png"),
  );
  check(
    "and it does NOT forbid the recolour the user just asked for",
    !/do not (redesign|restyle|recolor)/i.test(markLayerSlotDescription("Crown-U_Mark_Gold.png")),
    markLayerSlotDescription("Crown-U_Mark_Gold.png"),
  );

  // ---- does the decomposition survive the edit? (found by walking 5c) ----
  const TOL = 8;
  check("a clean layer edit keeps the decomposition", shouldCarryLayers(true, 0.4, TOL));
  check("drift exactly at tolerance still counts as clean", shouldCarryLayers(true, TOL, TOL));
  check("a repaint does not", !shouldCarryLayers(true, 41.2, TOL));
  check("notable drift does not either", !shouldCarryLayers(true, 12, TOL));
  check("UNMEASURED is not clean", !shouldCarryLayers(true, null, TOL));
  check("an UNSCOPED edit never carries, however clean", !shouldCarryLayers(false, 0, TOL));
  /*
   * The fourth gate doc 46 §6 found. A hand-drawn box is a real scope measured
   * by the same `measureDrift(before, after, region)` call, so the containment
   * argument holds and the decomposition survives. Refusing it threw away
   * something the user had paid for, and blamed a case that had not happened.
   */
  check("a clean HAND-DRAWN box edit carries too — a scope is a scope", shouldCarryLayers(true, 0.4, TOL));
  check("but a dirty box edit still does not", !shouldCarryLayers(true, 30, TOL));
  check(
    "a MOVE never carries, however clean, because the row no longer knows where the layer is",
    !shouldCarryLayers(true, 0, TOL, true),
  );

  // ---- the sentence ----
  /*
   * The frame border's own box is 0.87 of the frame — a keyline runs the whole
   * edge, so it cannot be tight. This assertion originally expected no broad
   * clause and the code was right: the disclosure belongs here.
   */
  check(
    "the summary counts what was FOUND, the matches, and discloses the broad one",
    detectionSummary(attributed)
      === "Found 3 elements in the picture, 2 matched to a file you attached. One covers most of the frame, so editing it will not stay in a corner.",
    detectionSummary(attributed),
  );
  /*
   * "2 layers found" under a heading reading "Layers · 3" read as a
   * contradiction on screen: the heading counts the base, detection never finds
   * it. So detection reports ELEMENTS found in the picture.
   */
  check(
    "detection never calls its findings layers, because the base is a layer and it is not found",
    !detectionSummary(attributed).toLowerCase().includes("layer"),
    detectionSummary(attributed),
  );
  check(
    "a fully matched set says so rather than repeating the count",
    detectionSummary(attributeToCast(
      normalizeDetected([row("Crown U Mark", "mark", [88, 93, 204, 256]), row("Female Tennis Player", "character", [160, 417, 953, 952])]),
      CAST,
    )) === "Found 2 elements in the picture, all matched to a file you attached.",
    detectionSummary(attributeToCast(
      normalizeDetected([row("Crown U Mark", "mark", [88, 93, 204, 256]), row("Female Tennis Player", "character", [160, 417, 953, 952])]),
      CAST,
    )),
  );
  check(
    "finding nothing is said plainly, not as a failure",
    detectionSummary([]) === "Nothing separable was found in this picture, so it stays one layer.",
  );
  check(
    "a broad layer is disclosed in the sentence",
    detectionSummary(attributeToCast(normalizeDetected([row("Diagonal Slash Device", "device", [114, 0, 1000, 1000])]), CAST))
      === "Found 1 element in the picture. One covers most of the frame, so editing it will not stay in a corner.",
    detectionSummary(attributeToCast(normalizeDetected([row("Diagonal Slash Device", "device", [114, 0, 1000, 1000])]), CAST)),
  );

  return results;
}
