/**
 * Assertions for what a take is made of.
 *
 * The ones that matter are the judgements a naive "list the attached assets"
 * would get wrong: a style reference is not a layer, the background style
 * reference attributes the base instead of becoming one, a mark is named for
 * its brand rather than its filename, and a cast layer is never given a box it
 * has not been measured into.
 */
import {
  castLayers,
  castOf,
  isMarkAsset,
  isSubjectAsset,
  layerName,
  layersSummary,
  type CastAsset,
} from "./take-layers.js";

const asset = (over: Partial<CastAsset> & { id: string; name: string }): CastAsset => ({
  assetClass: null,
  generationRole: null,
  brandLayer: null,
  franchise: null,
  depictedEntities: null,
  fileUrl: `/api/files/${over.id}.png`,
  thumbnailUrl: null,
  ...over,
});

/** The three cast rows off the live Crown U race take, verbatim. */
const SUBJECT = asset({
  id: "839b59b9",
  name: "crownu_char_female_sparq_soccer_default_01.jpeg",
  assetClass: "subject_reference",
  generationRole: "primary_subject",
  franchise: "Crown U",
  depictedEntities: [
    "female soccer player",
    "SPARQ GAMES logo",
    "jersey number 3",
    "glowing armband",
  ],
});
const MARK = asset({
  id: "b44b41f8",
  name: "Crown-U_Mark_Gold.png",
  assetClass: "compositing",
  generationRole: "overlay",
  brandLayer: "secondary_mark",
  depictedEntities: ["Crown U"],
});
const BACKDROP = asset({
  id: "a7df1514",
  name: "style_background_arena-mid-angle-start-side-06.png",
  assetClass: "style_reference",
  generationRole: "background",
  depictedEntities: ["stadium", "starting platform"],
});
const SWATCH = asset({
  id: "4d4d82a8",
  name: "ref_brand_sparq_brand_identity_guide_page_15_image_0005.png",
  assetClass: "style_reference",
  generationRole: "supporting",
  depictedEntities: [],
});

const LIVE_PAYLOAD = {
  imageUrl: "/api/files/generated/full-beat1__b.png",
  material: {
    subjectPin: { assetId: "839b59b9", briefTakeId: "0b13e86d" },
    directorSelections: [
      { role: "subject", assetId: "839b59b9" },
      { role: "object", assetId: "b44b41f8" },
      { role: "style", assetId: "a7df1514" },
      { role: "style", assetId: "4d4d82a8" },
    ],
  },
};

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- reading the cast off a take ----
  const cast = castOf(LIVE_PAYLOAD);
  check("the live take's cast is four members", cast.length === 4, cast.length);
  check("the pinned subject is marked pinned", cast.find(c => c.assetId === "839b59b9")?.pinned === true);
  check("nothing else is marked pinned", cast.filter(c => c.pinned).length === 1);
  check("a take with no material has no cast", castOf({ imageUrl: "/x.png" }).length === 0);
  check("a null payload has no cast", castOf(null).length === 0);
  check(
    "a selection with an unknown role is dropped, not repaired",
    castOf({ material: { directorSelections: [{ role: "villain", assetId: "z" }] } }).length === 0,
  );
  check(
    "the same asset selected twice is one cast member",
    castOf({
      material: {
        directorSelections: [
          { role: "subject", assetId: "dup" },
          { role: "object", assetId: "dup" },
        ],
      },
    }).length === 1,
  );
  check(
    "a pin with no selection row is still in the cast",
    (() => {
      const c = castOf({ material: { subjectPin: { assetId: "lonely" }, directorSelections: [] } });
      return c.length === 1 && c[0].assetId === "lonely" && c[0].pinned;
    })(),
  );

  // ---- classifying ----
  check("the mark asset reads as a mark", isMarkAsset(MARK));
  check("the character does not read as a mark", !isMarkAsset(SUBJECT));
  check("the character reads as a subject", isSubjectAsset(SUBJECT));
  check("the backdrop is neither", !isMarkAsset(BACKDROP) && !isSubjectAsset(BACKDROP));

  // ---- naming: a filename is never a name ----
  check("a mark is named for its brand", layerName(MARK, "mark", "Crown U") === "Crown U Mark", layerName(MARK, "mark", "Crown U"));
  check(
    "a mark with no franchise falls back to the brand's name",
    layerName(asset({ id: "m", name: "mark.png", assetClass: "compositing" }), "mark", "Westview") === "Westview Mark",
  );
  check(
    "a subject is named for who it depicts, not its file",
    layerName(SUBJECT, "subject", "Crown U") === "Crown U Female Soccer Player",
    layerName(SUBJECT, "subject", "Crown U"),
  );
  check(
    "logo and number entities are skipped when naming a subject",
    !layerName(SUBJECT, "subject", "Crown U").toLowerCase().includes("logo"),
  );
  check(
    "a subject with no usable entity is still named something readable",
    layerName(asset({ id: "s", name: "x.png", franchise: "Crown U", depictedEntities: ["SPARQ GAMES logo"] }), "subject", null)
      === "Crown U Subject",
  );

  // ---- the layer list ----
  const layers = castLayers({ cast, assets: [SUBJECT, MARK, BACKDROP, SWATCH], brandName: "Crown U" });
  check("the live take makes three layers", layers.length === 3, layers.map(l => l.name));
  check("back to front: base, subject, mark", layers.map(l => l.kind).join(",") === "base,subject,mark", layers.map(l => l.kind));
  check("the base is attributed to the background style reference", layers[0].assetId === BACKDROP.id);
  check("the base covers the whole frame", JSON.stringify(layers[0].bbox) === JSON.stringify({ x: 0, y: 0, w: 1, h: 1 }));
  check(
    "a style reference that is not a background is not a layer",
    !layers.some(l => l.assetId === SWATCH.id),
    layers.map(l => l.assetName),
  );
  check("the subject layer carries the real asset behind it", layers[1].assetId === SUBJECT.id);
  check("the subject layer says it is pinned", layers[1].pinned);
  check("the mark layer says it is the real file", (layers[2].note ?? "").includes("real mark file"));
  check(
    "a known cast layer is never given a box it was not measured into",
    layers.filter(l => l.kind !== "base").every(l => l.bbox === null),
  );
  check("every cast layer is class one", layers.every(l => l.origin === "known_cast"));
  check(
    "an asset that no longer resolves is dropped rather than invented",
    castLayers({ cast, assets: [SUBJECT], brandName: "Crown U" }).length === 2,
  );

  // ---- the sentence ----
  check(
    "the summary counts elements on a base and admits they are unlocated",
    layersSummary(layers) === "2 known elements on a base, not yet located in the picture.",
    layersSummary(layers),
  );
  check(
    "a take with nothing attached says so",
    layersSummary(castLayers({ cast: [], assets: [], brandName: "Crown U" }))
      === "Nothing was attached to this take, so only its base is known.",
  );
  check(
    "one element is singular",
    layersSummary(castLayers({ cast: [cast[1]], assets: [MARK], brandName: "Crown U" }))
      === "1 known element on a base, not yet located in the picture.",
    layersSummary(castLayers({ cast: [cast[1]], assets: [MARK], brandName: "Crown U" })),
  );

  return results;
}
