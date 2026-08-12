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
  layerScopeSentence,
  nameOverlap,
  normalizeDetected,
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

  // ---- the sentence ----
  /*
   * The frame border's own box is 0.87 of the frame — a keyline runs the whole
   * edge, so it cannot be tight. This assertion originally expected no broad
   * clause and the code was right: the disclosure belongs here.
   */
  check(
    "the summary counts the layers, the matches, and discloses the broad one",
    detectionSummary(attributed)
      === "3 layers found, 2 matched to a file you attached. One covers most of the frame, so editing it will not stay in a corner.",
    detectionSummary(attributed),
  );
  check(
    "finding nothing is said plainly, not as a failure",
    detectionSummary([]) === "Nothing separable was found in this picture, so it stays one layer.",
  );
  check(
    "a broad layer is disclosed in the sentence",
    detectionSummary(attributeToCast(normalizeDetected([row("Diagonal Slash Device", "device", [114, 0, 1000, 1000])]), CAST))
      === "1 layer found. One covers most of the frame, so editing it will not stay in a corner.",
    detectionSummary(attributeToCast(normalizeDetected([row("Diagonal Slash Device", "device", [114, 0, 1000, 1000])]), CAST)),
  );

  return results;
}
