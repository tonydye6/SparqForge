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
  castOfLineage,
  isMarkAsset,
  isSubjectAsset,
  layerName,
  layersSummary,
  lineagePayloads,
  MAX_LINEAGE_DEPTH,
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
    "the franchise is not repeated when the entity already names it",
    layerName(
      asset({ id: "t", name: "crownu_char_female_blue_tennis_default.jpeg", franchise: "Crown U", depictedEntities: ["Crown U tennis athlete"] }),
      "subject",
      "Crown U",
    ) === "Crown U Tennis Athlete",
    layerName(
      asset({ id: "t", name: "x.jpeg", franchise: "Crown U", depictedEntities: ["Crown U tennis athlete"] }),
      "subject",
      "Crown U",
    ),
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

  // ---- lineage: an edit must not lose the cast ----
  /** What a refine or region edit actually records: no cast of its own. */
  const EDIT_PAYLOAD = {
    imageUrl: "/api/files/generated/refined.png",
    instruction: "reposition the subject",
    material: { referenceCount: 1, director: null, autoAttachedMark: null },
  };
  check("an edit take records no cast of its own", castOf(EDIT_PAYLOAD).length === 0);

  const chain = [
    { id: "t3", takeIndex: 3, payload: { ...EDIT_PAYLOAD, sourceTakeId: "t2" } },
    { id: "t2", takeIndex: 2, payload: { ...EDIT_PAYLOAD, sourceTakeId: "t1" } },
    { id: "t1", takeIndex: 1, payload: LIVE_PAYLOAD },
  ];
  check("the lineage of the newest take reaches the generated one", lineagePayloads(chain, "t3").length === 3);
  const inherited = castOfLineage(lineagePayloads(chain, "t3"));
  check("two edits deep, the cast survives", inherited.length === 4, inherited.length);
  check("everything carried is marked inherited", inherited.every(c => c.inherited));
  check("the pin survives the edits", inherited.find(c => c.assetId === "839b59b9")?.pinned === true);

  const ownAndInherited = castOfLineage(lineagePayloads(
    [
      {
        id: "t4",
        takeIndex: 4,
        payload: {
          ...EDIT_PAYLOAD,
          sourceTakeId: "t1",
          material: { ...EDIT_PAYLOAD.material, directorSelections: [{ role: "object", assetId: "b44b41f8" }] },
        },
      },
      { id: "t1", takeIndex: 1, payload: LIVE_PAYLOAD },
    ],
    "t4",
  ));
  check(
    "an asset this edit re-attached is its own, not inherited",
    ownAndInherited.find(c => c.assetId === "b44b41f8")?.inherited === false,
  );
  check(
    "everything else in that take is still inherited",
    ownAndInherited.filter(c => c.assetId !== "b44b41f8").every(c => c.inherited),
  );

  /*
   * The case sourceTakeId exists for: restore take 1, then refine. Take 4's
   * parent is take 1, not take 3, so following the index alone would inherit
   * from a take that is not in this picture's history at all.
   */
  const restored = [
    { id: "t4", takeIndex: 4, payload: { ...EDIT_PAYLOAD, sourceTakeId: "t1" } },
    { id: "t3", takeIndex: 3, payload: { material: { directorSelections: [{ role: "subject", assetId: "wrong" }] } } },
    { id: "t1", takeIndex: 1, payload: LIVE_PAYLOAD },
  ];
  check(
    "a restore-then-refine follows its real parent, not the higher index",
    !castOfLineage(lineagePayloads(restored, "t4")).some(c => c.assetId === "wrong"),
    castOfLineage(lineagePayloads(restored, "t4")).map(c => c.assetId),
  );
  check(
    "a take with no recorded parent still falls back to the index below it",
    lineagePayloads(
      [
        { id: "b", takeIndex: 2, payload: EDIT_PAYLOAD },
        { id: "a", takeIndex: 1, payload: LIVE_PAYLOAD },
      ],
      "b",
    ).length === 2,
  );
  check(
    "a chain that points at itself terminates",
    lineagePayloads([{ id: "loop", takeIndex: 1, payload: { sourceTakeId: "loop" } }], "loop").length === 1,
  );
  check(
    "a long slot is walked only to the cap",
    lineagePayloads(
      Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, takeIndex: 40 - i, payload: EDIT_PAYLOAD })),
      "x0",
    ).length === MAX_LINEAGE_DEPTH,
  );

  const inheritedLayers = castLayers({
    cast: inherited,
    assets: [SUBJECT, MARK, BACKDROP, SWATCH],
    brandName: "Crown U",
  });
  check(
    "an inherited element is its own class, not presented as known",
    inheritedLayers.filter(l => l.kind !== "base").every(l => l.origin === "inherited_cast"),
    inheritedLayers.map(l => l.origin),
  );
  check(
    "an inherited row admits an edit since could have changed it",
    (inheritedLayers[1].note ?? "").includes("could have changed it"),
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
  check(
    "an all-inherited list says carried, never known",
    layersSummary(inheritedLayers) === "2 elements carried from the take this was edited from, not yet located.",
    layersSummary(inheritedLayers),
  );
  check(
    "a mixed list counts the two classes apart",
    layersSummary(castLayers({ cast: ownAndInherited, assets: [SUBJECT, MARK, BACKDROP], brandName: "Crown U" }))
      === "1 known element and 1 carried forward, on a base, not yet located.",
    layersSummary(castLayers({ cast: ownAndInherited, assets: [SUBJECT, MARK, BACKDROP], brandName: "Crown U" })),
  );

  return results;
}
