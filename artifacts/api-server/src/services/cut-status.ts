/**
 * Sequencing build step 3 · what the cut is, and whether the render still is it.
 *
 * Two questions, one place, so the bar on the Sequence tab and the endpoint
 * that refuses a pointless render cannot disagree:
 *
 * **What is in this cut** — the sentence the bar shows ("2 shots · 6.0s ·
 * voice + music + 1 SFX · not rendered yet"). Assembled from the rows, never
 * typed into the client, because a summary that drifts from the rows is how a
 * person presses Render expecting something else.
 *
 * **Is the rendered file still the cut** — the fingerprint. Staleness in this
 * product is always a lineage question and it is always answered by comparing
 * what a thing consumed with what is there now. A timestamp cannot answer it
 * here: reordering shots changes no `createdAt`, and re-picking the still
 * upstream changes no sequence row at all. So the render stamps EXACTLY what
 * it consumed and this recomputes it. Different string means stale, in the
 * same words as every other stage, and nothing ever re-renders itself.
 *
 * Pure: no DB, no ffmpeg, no clock.
 */

export type RenderStatus = "draft" | "rendering" | "rendered" | "failed";

/** The clip fields a render actually consumes. Anything else cannot stale it. */
export interface CutClip {
  id: string;
  position: number;
  trimStartMs: number;
  trimEndMs: number;
  transitionIn: "cut" | "dissolve";
  sourceKind: "generated" | "library_asset" | "upload" | "studio_take";
  sourceVariantId?: string | null;
  sourceAssetId?: string | null;
  sourceTakeId?: string | null;
  uploadUrl?: string | null;
  sourceMissingAt?: Date | string | null;
}

/** The track fields a render actually consumes. */
export interface CutTrack {
  id: string;
  trackKind: "voice" | "music" | "sfx" | "native";
  audioUrl?: string | null;
  startMs: number;
  durationMs: number | null;
  gainDb: number;
  duckUnder?: string | null;
  duckAmountDb?: number | null;
}

/** Which thing a clip points at, whatever kind it is. */
export function clipPointer(clip: CutClip): string | null {
  switch (clip.sourceKind) {
    case "generated": return clip.sourceVariantId ?? null;
    case "library_asset": return clip.sourceAssetId ?? null;
    case "studio_take": return clip.sourceTakeId ?? null;
    case "upload": return clip.uploadUrl ?? null;
    default: return null;
  }
}

/**
 * What the render consumed, as one comparable string.
 *
 * Ordered by position rather than by arrival, because two sequences with the
 * same shots in the same order ARE the same cut however the rows were written;
 * tracks are sorted by id for the same reason. The gain and the duck are in
 * here because they change the mix and therefore the file — a level nudge that
 * left the cut reading "rendered" would ship the old balance.
 */
export function computeCutFingerprint(clips: readonly CutClip[], tracks: readonly CutTrack[]): string {
  const clipPart = [...clips]
    .sort((a, b) => a.position - b.position)
    .map(c => [
      c.sourceKind,
      clipPointer(c) ?? "-",
      c.trimStartMs,
      c.trimEndMs,
      c.transitionIn,
      c.sourceMissingAt ? "missing" : "ok",
    ].join(":"))
    .join("|");

  const trackPart = [...tracks]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(t => [
      t.trackKind,
      t.audioUrl ?? "-",
      t.startMs,
      t.durationMs ?? "-",
      t.gainDb,
      t.duckUnder ?? "-",
      t.duckAmountDb ?? "-",
    ].join(":"))
    .join("|");

  return `v1;clips=${clipPart};tracks=${trackPart}`;
}

export type CutState =
  | "empty"      // nothing to render
  | "unrendered" // has shots, never rendered
  | "rendering"  // a render is in flight
  | "rendered"   // the file is the cut
  | "stale"      // rendered, then something changed
  | "failed";    // the last render did not finish

export interface CutStatus {
  state: CutState;
  /** The bar's one line: what is in the cut and where it stands. */
  summary: string;
  /** Why Render cannot run right now, in words, or null. */
  blocked: string | null;
  renderedUrl: string | null;
  totalDurationMs: number;
  /** What the cut is NOW, for the render to stamp and the next read to compare. */
  fingerprint: string;
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * The sound half of the summary: "voice + music + 2 SFX".
 *
 * SFX are counted because they are hits at moments and two is materially
 * different from one; voice and music are named because there is one of each.
 */
export function describeSound(tracks: readonly CutTrack[]): string {
  const parts: string[] = [];
  const count = (kind: CutTrack["trackKind"]): number => tracks.filter(t => t.trackKind === kind).length;
  const voices = count("voice");
  const music = count("music");
  const sfx = count("sfx");
  const native = count("native");
  if (voices === 1) parts.push("voice");
  else if (voices > 1) parts.push(`${voices} voices`);
  if (music === 1) parts.push("music");
  else if (music > 1) parts.push(`${music} music beds`);
  if (sfx === 1) parts.push("1 SFX");
  else if (sfx > 1) parts.push(`${sfx} SFX`);
  if (native > 0) parts.push("clip audio");
  return parts.join(" + ");
}

export function cutStatus(input: {
  renderStatus: RenderStatus;
  renderedUrl: string | null;
  renderFingerprint: string | null;
  clips: readonly CutClip[];
  tracks: readonly CutTrack[];
  /** From the sequence plan: false when a clip lost the file it pointed at. */
  renderable: boolean;
  /** From the sequence plan, so the bar and the render agree on the length. */
  totalDurationMs: number;
}): CutStatus {
  const { clips, tracks, renderable, totalDurationMs } = input;
  const fingerprint = computeCutFingerprint(clips, tracks);
  const shots = clips.length;
  const sound = describeSound(tracks);
  const body = `${shots} shot${shots === 1 ? "" : "s"} · ${secs(totalDurationMs)}${sound ? ` · ${sound}` : ""}`;

  if (shots === 0) {
    return {
      state: "empty",
      summary: "No shots yet, so there is nothing to render.",
      blocked: "Add a shot first.",
      renderedUrl: null,
      totalDurationMs,
      fingerprint,
    };
  }

  /*
   * A missing source blocks the render rather than warning about it. The plan
   * already refuses to emit a graph in that case, so pressing Render would
   * fail inside ffmpeg with a message from the wrong layer.
   */
  const blocked = renderable
    ? null
    : "A shot has lost the file it pointed at. Replace it or remove it before rendering.";

  if (input.renderStatus === "rendering") {
    return {
      state: "rendering",
      summary: `${body} · rendering now`,
      blocked: "A render is already running on this cut.",
      renderedUrl: null,
      totalDurationMs,
      fingerprint,
    };
  }

  if (input.renderStatus === "rendered" && input.renderedUrl) {
    if (input.renderFingerprint === fingerprint) {
      return {
        state: "rendered",
        summary: `Rendered ${secs(totalDurationMs)} · ships with every channel version`,
        blocked,
        renderedUrl: input.renderedUrl,
        totalDurationMs,
        fingerprint,
      };
    }
    /*
     * Rendered, then edited. The old file is kept and still named, because it
     * is what shipped and deleting it would take away the only thing the post
     * currently has; it is simply no longer THIS cut.
     */
    return {
      state: "stale",
      summary: `${body} · the cut changed since it rendered, so the rendered file is stale`,
      blocked,
      renderedUrl: input.renderedUrl,
      totalDurationMs,
      fingerprint,
    };
  }

  if (input.renderStatus === "failed") {
    return {
      state: "failed",
      summary: `${body} · the last render did not finish`,
      blocked,
      renderedUrl: null,
      totalDurationMs,
      fingerprint,
    };
  }

  return {
    state: "unrendered",
    summary: `${body} · not rendered yet`,
    blocked,
    renderedUrl: null,
    totalDurationMs,
    fingerprint,
  };
}
