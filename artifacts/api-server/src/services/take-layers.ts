/**
 * Stage 03 · Refine · what a take is made of.
 *
 * Layer decomposition, class 1: the CAST. Pure, so the naming and the ordering
 * are testable without a model, a database or an image.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE CAST AND NOT "RECONSTRUCTED KNOWN LAYERS"
 *
 * Doc 45 §4 planned a free first increment that rebuilds the layers of a
 * DESIGNED take — headline as real text, the mark as its real file, the subject
 * cutout, the base — on the grounds that SparqMake authored the composition and
 * therefore knows it. That is true of `designed-compositor.ts`, which really
 * does composite a graphic layer by layer. It is NOT true of the surface this
 * feature lives on: `designed-take.ts` is reachable only from
 * `routes/generate.ts` — the legacy Co-pilot path — and stage 03's takes are
 * flat rasters returned whole by the image model. Refine has no design spec, no
 * cutout and no composite to take apart. Verified by call graph, not assumed:
 * `prepareDesignedTake`, `compositeDesignedGraphic`, `renderHeadlineIntoImage`
 * and `detectSubject` have no caller inside the Studio v2 stack.
 *
 * What stage 03 genuinely knows is different, and better than nothing: it knows
 * the CAST. Every take records which real asset FILES were fed to the model and
 * in which role — the pinned subject, the brand mark, the style references. So
 * we know WHO is in the picture and from which authoritative file, but not
 * WHERE they landed, because the model drew them rather than us pasting them.
 *
 * That is the honest shape of the two classes here:
 *   · KNOWN CAST      — identity, provenance and name, free and true by
 *                       construction, read straight off the take.
 *   · INFERRED        — geometry, and every element nobody attached. One vision
 *                       pass, run BLIND, with the cast applied afterwards as
 *                       attribution.
 *
 * THIS HEADER USED TO SAY THE CAST STEERS DETECTION — that telling the detector
 * the picture holds this specific mark is what makes it answer "Crown U Mark"
 * rather than "logo". A controlled A/B disproved it: the mark is legible in the
 * picture, so the model reads the brand off it unaided, and the hint acts as a
 * checklist that STOPS it looking (3 elements steered against 4 and 5 blind).
 * See `layer-detection.ts`'s header for the numbers. Detection therefore runs
 * blind and the cast supplies the authoritative file and name afterwards, where
 * the match is auditable instead of baked into a prompt.
 *
 * Knowing the cast is still the whole advantage over decomposing a stranger's
 * flat file — it is just provenance rather than steering.
 * ---------------------------------------------------------------------------
 */

/**
 * Where a layer came from, which is the two-class design made explicit.
 *
 * `inherited_cast` is the third state the first walk of this feature forced.
 * Refine's own takes — a refine sentence or a region edit — attach the BEFORE
 * IMAGE to the model, not the character file, so they record no cast at all and
 * a refined take listed nothing but its base. Inheriting the cast of the take
 * an edit was made from fixes that, but it is a claim about lineage rather than
 * a record of what this render was handed: the demo post's own history contains
 * the take "remove the crown logo", and an inherited mark layer would assert a
 * mark is in a picture somebody removed it from. So it is a different class,
 * labelled, and detection is what settles it.
 */
export type LayerOrigin = "known_cast" | "inherited_cast" | "detected";

export type LayerKind = "base" | "subject" | "mark" | "element";

/** The asset columns this module needs. A subset, so tests need no DB row. */
export interface CastAsset {
  id: string;
  name: string;
  assetClass: string | null;
  generationRole: string | null;
  brandLayer: string | null;
  franchise: string | null;
  depictedEntities: string[] | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
}

export interface TakeLayer {
  /** Stable within a take, so a client can key rows across refreshes. */
  key: string;
  name: string;
  kind: LayerKind;
  origin: LayerOrigin;
  /** The authoritative source file, when this layer has one. */
  assetId: string | null;
  assetName: string | null;
  thumbnailUrl: string | null;
  /**
   * Normalised 0..1, back-to-front order already applied by the array. Null
   * until something locates it — a cast layer is known to be IN the picture
   * without being known to be anywhere in particular, and saying so is the
   * point. Never guess a box: a wrong box scopes an edit to the wrong pixels.
   */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** Held across runs of the same brief, so a re-run cannot recast it. */
  pinned: boolean;
  /**
   * What this layer owes its existence to, in the user's words. Empty for the
   * layers that need no explanation.
   */
  note: string | null;
}

/** One row of `material.directorSelections`, plus the pin. */
export interface CastMember {
  assetId: string;
  role: "subject" | "object" | "style";
  pinned: boolean;
  /** True when this came from an ancestor take rather than from this one. */
  inherited: boolean;
}

/**
 * The cast, read off a take payload.
 *
 * Re-validated rather than trusted, exactly as `routes/storyboard.ts` does it:
 * `stage_takes.payload` is stored as unknown json and these ids become asset
 * lookups.
 */
export function castOf(payload: unknown): CastMember[] {
  const p = payload as {
    material?: {
      directorSelections?: unknown;
      subjectPin?: { assetId?: unknown } | null;
    };
  } | null;
  const pinnedId = typeof p?.material?.subjectPin?.assetId === "string"
    ? p.material.subjectPin.assetId
    : null;

  const rows = Array.isArray(p?.material?.directorSelections) ? p.material.directorSelections : [];
  const out: CastMember[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const r = raw as { assetId?: unknown; role?: unknown };
    if (typeof r?.assetId !== "string" || r.assetId.length === 0) continue;
    if (r.role !== "subject" && r.role !== "object" && r.role !== "style") continue;
    if (seen.has(r.assetId)) continue;
    seen.add(r.assetId);
    out.push({ assetId: r.assetId, role: r.role, pinned: r.assetId === pinnedId, inherited: false });
  }

  /*
   * A pin with no selection row still belongs in the cast. The pin is what
   * holds a character across runs, so losing it here would mean the layer list
   * disagreed with the picture on the one element the app works hardest to keep
   * constant.
   */
  if (pinnedId && !seen.has(pinnedId)) {
    out.unshift({ assetId: pinnedId, role: "subject", pinned: true, inherited: false });
  }
  return out;
}

/**
 * The cast of a take AND of the takes it was edited from, newest first.
 *
 * A refine or a region edit hands the model the previous PICTURE, so its own
 * record names only what that edit added. The character and the mark are still
 * in the frame; only the paperwork stopped mentioning them. Walking the lineage
 * is what makes the layer list survive an edit — see `LayerOrigin` for why the
 * inherited half is a separate class rather than folded into the first.
 *
 * The take's own cast wins on a collision, so an asset this edit genuinely
 * re-attached is reported as its own rather than as inherited.
 */
export function castOfLineage(payloadsNewestFirst: unknown[]): CastMember[] {
  const out: CastMember[] = [];
  const seen = new Set<string>();
  for (const [depth, payload] of payloadsNewestFirst.entries()) {
    for (const member of castOf(payload)) {
      if (seen.has(member.assetId)) continue;
      seen.add(member.assetId);
      out.push(depth === 0 ? member : { ...member, inherited: true });
    }
  }
  return out;
}

/** The take rows this module needs to walk a slot's lineage. */
export interface LineageTake {
  id: string;
  takeIndex: number;
  payload: unknown;
}

/**
 * How far back a lineage is followed. A slot can hold dozens of takes and the
 * cast stops changing long before that; the cap is a guard against a malformed
 * chain, not a product rule.
 */
export const MAX_LINEAGE_DEPTH = 12;

/**
 * The payloads that produced this take, newest first, starting with its own.
 *
 * Follows `sourceTakeId` when the take records one, because that is the take an
 * edit was actually made from — and after somebody restores an earlier take and
 * refines it, the previous take by INDEX is not its parent. Where no
 * `sourceTakeId` is recorded (every take written before this existed) it falls
 * back to the next-lower index in the same slot, which is what the chain was
 * before restores were possible.
 */
export function lineagePayloads(takes: LineageTake[], currentId: string): unknown[] {
  const byId = new Map(takes.map(t => [t.id, t]));
  const descending = [...takes].sort((a, b) => b.takeIndex - a.takeIndex);

  const out: unknown[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(currentId) ?? null;

  while (cursor && !seen.has(cursor.id) && out.length < MAX_LINEAGE_DEPTH) {
    seen.add(cursor.id);
    out.push(cursor.payload);
    const sourceId = (cursor.payload as { sourceTakeId?: unknown } | null)?.sourceTakeId;
    const parent = typeof sourceId === "string" ? byId.get(sourceId) : undefined;
    cursor = parent
      ?? descending.find(t => t.takeIndex < cursor!.takeIndex && !seen.has(t.id))
      ?? null;
  }
  return out;
}

/** Words in a depicted entity that mean it is furniture, not the character. */
const NOT_A_SUBJECT = /\b(logo|mark|wordmark|swoosh|number|text|typography|badge|hex|swatch)\b/i;

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map(w => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Is this asset a brand mark rather than a character or a style cue? */
export function isMarkAsset(a: CastAsset): boolean {
  return (
    a.assetClass === "compositing" ||
    a.generationRole === "overlay" ||
    typeof a.brandLayer === "string" && a.brandLayer.length > 0
  );
}

export function isSubjectAsset(a: CastAsset): boolean {
  return a.assetClass === "subject_reference" || a.generationRole === "primary_subject";
}

/**
 * The layer's name, which doc 45 §1.1 identifies as the striking part of the
 * feature: a decomposition is only useful if the rows say what the elements
 * ARE. A filename is not a name, so nothing here ever falls back to one.
 */
export function layerName(a: CastAsset, kind: LayerKind, brandName: string | null): string {
  const holder = a.franchise ?? brandName;
  if (kind === "mark") return holder ? `${holder} Mark` : "Brand Mark";
  if (kind === "subject" || kind === "element") {
    const entity = (a.depictedEntities ?? []).find(e => typeof e === "string" && e.trim() && !NOT_A_SUBJECT.test(e));
    /*
     * "Subject" only for something actually attached as one. An `element` that
     * names nothing depictable is called what it is — a prop is not the subject
     * of the picture, and saying so was actively misleading (doc 46 §7.4).
     */
    const noun = entity ? titleCase(entity) : kind === "subject" ? "Subject" : "Element";
    /*
     * The entity often already names the franchise — the tennis character's
     * first entity is literally "Crown U tennis athlete" — and prefixing it
     * again produced "Crown U Crown U Tennis Athlete" on the first live read.
     * Caught by walking; a filename would never have shown it.
     */
    if (!holder || noun.toLowerCase().includes(holder.toLowerCase())) return noun;
    return `${holder} ${noun}`;
  }
  return "Base";
}

export interface CastLayersInput {
  cast: CastMember[];
  /** Only the assets that resolved; a deleted one is dropped, never guessed. */
  assets: CastAsset[];
  brandName: string | null;
}

/**
 * The cast as layers, ordered BACK TO FRONT.
 *
 * Base first because everything sits on it, then subjects, then marks — a mark
 * overlays by definition, and in the one composition this was first read
 * against it is a chest logo on the character, i.e. in front of her. This is a
 * DEFAULT ordering, not a measurement; detection is what earns the right to
 * reorder, and until then the list says nothing it has not been told.
 */
export function castLayers({ cast, assets, brandName }: CastLayersInput): TakeLayer[] {
  const byId = new Map(assets.map(a => [a.id, a]));

  /*
   * THE BASE, AND WHAT STEERED IT.
   *
   * A style reference is NOT a layer: it shapes how the whole picture looks and
   * appears nowhere in it as a separable element, so listing one would put a
   * row in the list that can never be selected, moved or edited. The exception
   * is a style reference whose generation role is `background` — that one
   * genuinely describes the field everything else sits on, so it attributes the
   * Base layer instead of becoming a row of its own.
   */
  const backdrop = cast
    .map(c => byId.get(c.assetId))
    .find((a): a is CastAsset => !!a && a.assetClass === "style_reference" && a.generationRole === "background");

  const layers: TakeLayer[] = [{
    key: "base",
    name: "Base",
    kind: "base",
    origin: "known_cast",
    assetId: backdrop?.id ?? null,
    assetName: backdrop?.name ?? null,
    thumbnailUrl: backdrop?.thumbnailUrl ?? backdrop?.fileUrl ?? null,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    pinned: false,
    note: backdrop ? "The environment this scene was steered towards." : null,
  }];

  const subjects: TakeLayer[] = [];
  const marks: TakeLayer[] = [];

  for (const member of cast) {
    const a = byId.get(member.assetId);
    if (!a) continue;
    // Style references are not elements; the backdrop already attributed Base.
    if (a.assetClass === "style_reference") continue;

    const kind: LayerKind = isMarkAsset(a) ? "mark" : isSubjectAsset(a) ? "subject" : "element";
    const layer: TakeLayer = {
      key: `cast:${a.id}`,
      // Its own kind, `element` included. It used to be laundered through the
      // subject branch because `layerName` had no element case and fell through
      // to "Base", which could surface a prop as "Crown U Subject" in a feature
      // whose whole premise is that the name is trustworthy (doc 46 §7.4).
      name: layerName(a, kind, brandName),
      kind,
      origin: member.inherited ? "inherited_cast" : "known_cast",
      assetId: a.id,
      assetName: a.name,
      thumbnailUrl: a.thumbnailUrl ?? a.fileUrl ?? null,
      bbox: null,
      pinned: member.pinned,
      note: member.inherited
        // Never stated as fact. An edit since could have painted it out, and
        // saying so is cheaper than being caught claiming otherwise.
        ? "Carried from the take this was edited from. An edit since could have changed it."
        : kind === "mark"
          // The marks rule (doc 45 §4): a mark layer is the real file, never a
          // redraw, so the row can say where it came from without hedging.
          ? "The real mark file, attached to this render."
          : member.pinned
            ? "Held across every run of this brief."
            : null,
    };
    (kind === "mark" ? marks : subjects).push(layer);
  }

  return [...layers, ...subjects, ...marks];
}

/** A persisted `take_layers` row, as the merge needs it. */
export interface DetectedRow {
  id: string;
  layerIndex: number;
  name: string;
  kind: string;
  assetId: string | null;
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * The cast and the detected set, as one list.
 *
 * Ordering is the detected set's, because that ordering was MEASURED — it is
 * back-to-front as read off the picture, where the cast's order is only a
 * convention. Base stays first because everything sits on it.
 *
 * A cast member the detection did not account for is kept, still unlocated. It
 * is not evidence of a bug: a mark can be attached to a render and end up too
 * small to separate, or painted out by a later edit. Dropping it would hide
 * provenance the take genuinely records; promoting it would invent a position.
 * So it stays, and it still says NOT LOCATED.
 */
export function mergeLayers(cast: TakeLayer[], detected: DetectedRow[]): TakeLayer[] {
  const base = cast.find(l => l.kind === "base");
  const castByAsset = new Map(cast.filter(l => l.assetId && l.kind !== "base").map(l => [l.assetId!, l]));

  const out: TakeLayer[] = base ? [base] : [];
  const claimed = new Set<string>();

  for (const row of [...detected].sort((a, b) => a.layerIndex - b.layerIndex)) {
    const matched = row.assetId ? castByAsset.get(row.assetId) : undefined;
    if (matched?.assetId) claimed.add(matched.assetId);
    out.push({
      key: `layer:${row.id}`,
      name: row.name,
      kind: (matched?.kind ?? (row.kind === "character" ? "subject" : row.kind === "mark" ? "mark" : "element")) as LayerKind,
      origin: "detected",
      assetId: row.assetId,
      assetName: matched?.assetName ?? null,
      // The matched cast member's real file is the better thumbnail: it is the
      // element on its own, where a crop of the take carries its neighbours.
      thumbnailUrl: matched?.thumbnailUrl ?? null,
      bbox: row.bbox,
      pinned: matched?.pinned ?? false,
      note: matched
        ? "Found in the picture, and it is the file you attached."
        : "Found in the picture. Nothing you attached accounts for it.",
    });
  }

  for (const l of cast) {
    if (l.kind === "base") continue;
    if (l.assetId && claimed.has(l.assetId)) continue;
    out.push(l);
  }

  return out;
}

/**
 * The inspector's sentence.
 *
 * Assembled on the server for the same reason the storyboard's is: the count,
 * the class and the honesty about geometry must not be able to disagree with
 * each other across a client refactor.
 */
export function layersSummary(layers: TakeLayer[]): string {
  const detected = layers.filter(l => l.origin === "detected").length;
  if (detected > 0) {
    const unlocated = layers.filter(l => l.bbox === null).length;
    return `${layers.length} layers${unlocated > 0 ? `, ${unlocated} not located` : ""}.`;
  }

  // Base is always present and is not an element, so it never counts here.
  const own = layers.filter(l => l.origin === "known_cast" && l.kind !== "base").length;
  const inherited = layers.filter(l => l.origin === "inherited_cast").length;
  if (own + inherited === 0) return "Nothing was attached to this take, so only its base is known.";

  const noun = (n: number) => (n === 1 ? "element" : "elements");
  if (inherited === 0) {
    return `${own} known ${noun(own)} on a base, not yet located in the picture.`;
  }
  if (own === 0) {
    return `${inherited} ${noun(inherited)} carried from the take this was edited from, not yet located.`;
  }
  return `${own} known ${noun(own)} and ${inherited} carried forward, on a base, not yet located.`;
}
