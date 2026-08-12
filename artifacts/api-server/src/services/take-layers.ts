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
 *                       pass, and the cast STEERS it: a detector told the
 *                       picture contains this specific character and this
 *                       specific mark returns "Crown U Mark", not "logo".
 *
 * Knowing the cast before detecting is the whole advantage over decomposing a
 * stranger's flat file, and it survives the premise being wrong.
 * ---------------------------------------------------------------------------
 */

/** Where a layer came from, which is the two-class design made explicit. */
export type LayerOrigin = "known_cast" | "detected";

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
    out.push({ assetId: r.assetId, role: r.role, pinned: r.assetId === pinnedId });
  }

  /*
   * A pin with no selection row still belongs in the cast. The pin is what
   * holds a character across runs, so losing it here would mean the layer list
   * disagreed with the picture on the one element the app works hardest to keep
   * constant.
   */
  if (pinnedId && !seen.has(pinnedId)) {
    out.unshift({ assetId: pinnedId, role: "subject", pinned: true });
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
  if (kind === "subject") {
    const entity = (a.depictedEntities ?? []).find(e => typeof e === "string" && e.trim() && !NOT_A_SUBJECT.test(e));
    const noun = entity ? titleCase(entity) : "Subject";
    return holder ? `${holder} ${noun}` : noun;
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
      name: layerName(a, kind === "element" ? "subject" : kind, brandName),
      kind,
      origin: "known_cast",
      assetId: a.id,
      assetName: a.name,
      thumbnailUrl: a.thumbnailUrl ?? a.fileUrl ?? null,
      bbox: null,
      pinned: member.pinned,
      note: kind === "mark"
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

/**
 * The inspector's sentence.
 *
 * Assembled on the server for the same reason the storyboard's is: the count,
 * the class and the honesty about geometry must not be able to disagree with
 * each other across a client refactor.
 */
export function layersSummary(layers: TakeLayer[]): string {
  const known = layers.filter(l => l.origin === "known_cast").length;
  const detected = layers.filter(l => l.origin === "detected").length;
  const unlocated = layers.filter(l => l.bbox === null).length;

  if (detected === 0) {
    if (known <= 1) return "Nothing was attached to this take, so only its base is known.";
    const cast = known - 1;
    return unlocated === 0
      ? `${cast} known ${cast === 1 ? "element" : "elements"} on a base.`
      : `${cast} known ${cast === 1 ? "element" : "elements"} on a base, not yet located in the picture.`;
  }
  return `${layers.length} layers${unlocated > 0 ? `, ${unlocated} not located` : ""}.`;
}
