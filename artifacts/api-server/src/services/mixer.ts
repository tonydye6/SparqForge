/**
 * Phase 9 item 3 · the mixer.
 *
 * N tracks, per-track gain, and sidechain ducking read from `duckUnder` and
 * `duckAmountDb`. Pure: it turns rows into an ffmpeg filter graph and nothing
 * else. No files, no ffmpeg, no clock, so every decision below is arguable in a
 * test rather than discoverable only by listening to a render.
 *
 * **THE DUCK IS SCHEDULED, NOT LISTENED FOR.** Doc 21 §3.4 calls `duckUnder`
 * "sidechain ducking as data rather than a render-time guess", and that phrase
 * decides the implementation. ffmpeg's `sidechaincompress` would analyse the
 * voice signal and decide for itself when to pull the music down, which means
 * the same rows can render differently, nobody can see the ducked region before
 * paying for a render, and "why did it duck there" has no answer. Because the
 * voice track already carries `startMs` and `durationMs`, the duck is simply a
 * gain envelope over that window: deterministic, inspectable, and drawable on a
 * timeline before anything renders.
 */

export type TrackKind = "voice" | "music" | "sfx" | "native";

export interface MixTrack {
  id: string;
  trackKind: TrackKind;
  startMs: number;
  /** Null when the length is not known yet; such a track cannot duck anything. */
  durationMs: number | null;
  gainDb: number;
  /** The kind that ducks this track. Usually "voice". */
  duckUnder?: TrackKind | null;
  duckAmountDb?: number | null;
}

export interface DuckWindow { startMs: number; endMs: number }

export interface PlannedTrack {
  id: string;
  /** Position in the ffmpeg input list, which the caller must match exactly. */
  inputIndex: number;
  delayMs: number;
  gainDb: number;
  duckWindows: DuckWindow[];
  /** The per-track chain, ending in its own labelled output. */
  filter: string;
  label: string;
}

export interface MixPlan {
  tracks: PlannedTrack[];
  /** The complete `-filter_complex` argument. Empty when there is nothing to mix. */
  filterComplex: string;
  /** The label carrying the finished mix, for `-map`. */
  outputLabel: string;
  /**
   * Things the mix did NOT do, and why. Reported rather than swallowed: a duck
   * that silently never happened is the kind of thing people discover by
   * listening, three renders later.
   */
  warnings: string[];
}

export const DEFAULT_DUCK_DB = -12;

/** dB to an ffmpeg linear volume multiplier. */
export function dbToLinear(db: number): number {
  return Number(Math.pow(10, db / 20).toFixed(6));
}

/** Seconds, as ffmpeg expressions want them. */
function secs(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * Merge overlapping and touching windows.
 *
 * Two voice lines a heartbeat apart would otherwise produce two ducks with an
 * audible bump of full-volume music between them, which is the artefact that
 * makes automated ducking sound automated.
 */
export function mergeWindows(windows: readonly DuckWindow[]): DuckWindow[] {
  const sorted = [...windows].filter(w => w.endMs > w.startMs).sort((a, b) => a.startMs - b.startMs);
  const out: DuckWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, w.endMs);
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/**
 * Where a track should be pulled down, given everything else in the mix.
 *
 * A track never ducks under itself, and a ducking track with no known duration
 * is skipped with a warning rather than assumed to last forever.
 */
export function duckWindowsFor(
  track: MixTrack,
  all: readonly MixTrack[],
  warnings: string[],
): DuckWindow[] {
  if (!track.duckUnder) return [];

  const duckers = all.filter(t => t.id !== track.id && t.trackKind === track.duckUnder);
  if (duckers.length === 0) {
    warnings.push(
      `The ${track.trackKind} track is set to duck under ${track.duckUnder}, but there is no ` +
      `${track.duckUnder} track in this mix, so it plays at full level.`,
    );
    return [];
  }

  const windows: DuckWindow[] = [];
  for (const d of duckers) {
    if (d.durationMs === null || d.durationMs <= 0) {
      warnings.push(
        `A ${d.trackKind} track has no known length yet, so the ${track.trackKind} track cannot ` +
        `duck under it. Render the ${d.trackKind} first.`,
      );
      continue;
    }
    windows.push({ startMs: d.startMs, endMs: d.startMs + d.durationMs });
  }
  return mergeWindows(windows);
}

/**
 * Build the filter graph.
 *
 * Track order defines input order, and the caller MUST pass the files in the
 * same order: `inputIndex` is returned on every track so that contract is
 * checkable rather than implied.
 */
export function buildMixPlan(tracks: readonly MixTrack[]): MixPlan {
  const warnings: string[] = [];
  const planned: PlannedTrack[] = [];

  tracks.forEach((track, i) => {
    const windows = duckWindowsFor(track, tracks, warnings);
    const label = `m${i}`;
    const parts: string[] = [];

    // adelay wants a value per channel; two covers mono and stereo, and ffmpeg
    // ignores the surplus rather than erroring.
    if (track.startMs > 0) parts.push(`adelay=${track.startMs}|${track.startMs}`);
    if (track.gainDb !== 0) parts.push(`volume=${dbToLinear(track.gainDb)}`);

    const duckDb = typeof track.duckAmountDb === "number" ? track.duckAmountDb : DEFAULT_DUCK_DB;
    if (windows.length > 0 && duckDb !== 0) {
      /*
       * One enabled `volume` per window, rather than one expression with an
       * `if` chain. Both work; this one stays readable in the ffmpeg command a
       * person may have to debug, and §1.17's rule is that what we sent should
       * be inspectable.
       */
      for (const w of windows) {
        parts.push(
          `volume=${dbToLinear(duckDb)}:enable='between(t,${secs(w.startMs)},${secs(w.endMs)})'`,
        );
      }
    }

    // A track with no processing still needs a node, or its label does not exist.
    if (parts.length === 0) parts.push("anull");

    planned.push({
      id: track.id,
      inputIndex: i,
      delayMs: track.startMs,
      gainDb: track.gainDb,
      duckWindows: windows,
      label,
      filter: `[${i}:a]${parts.join(",")}[${label}]`,
    });
  });

  if (planned.length === 0) {
    return { tracks: [], filterComplex: "", outputLabel: "", warnings };
  }

  const outputLabel = "mixout";
  /*
   * `normalize=0` IS NOT OPTIONAL. amix normalizes by the number of inputs by
   * default, which quietly divides every track's level and undoes the per-track
   * gain the mixer exists to provide: add a third track and the first two get
   * quieter for no reason anybody can see. `duration=longest` so a short sting
   * does not truncate the bed.
   */
  const mix = `${planned.map(p => `[${p.label}]`).join("")}` +
    `amix=inputs=${planned.length}:duration=longest:normalize=0[${outputLabel}]`;

  return {
    tracks: planned,
    filterComplex: [...planned.map(p => p.filter), mix].join(";"),
    outputLabel,
    warnings,
  };
}

/**
 * The plain sentence describing what the mix will do, for the timeline's
 * "Why this" strip. One place, so the screen and the render cannot disagree.
 */
export function describeMix(plan: MixPlan): string {
  if (plan.tracks.length === 0) return "No audio tracks yet, so there is nothing to mix.";
  const ducked = plan.tracks.filter(t => t.duckWindows.length > 0);
  const base = `${plan.tracks.length} track${plan.tracks.length === 1 ? "" : "s"}`;
  if (ducked.length === 0) return `${base}, mixed at their own levels.`;
  const windows = ducked.reduce((n, t) => n + t.duckWindows.length, 0);
  return `${base}, with ${ducked.length} pulled down across ${windows} ` +
    `moment${windows === 1 ? "" : "s"} so the voice stays clear.`;
}
