/**
 * Phase 9 item 7 · ordered clips into one video.
 *
 * "Position plus trim is the entire model; Principle 1.16 forbids the rest"
 * (doc 21 §3.3). So this does exactly three things: order, trim, and join with
 * either a cut or a dissolve.
 *
 * **A dissolve is not free time, it is borrowed time.** Two 6s clips joined by a
 * 500ms dissolve run 11.5s, not 12: the clips OVERLAP for the length of the
 * transition. Getting that wrong is how a sequence's reported duration drifts
 * from the file it renders, which then breaks every downstream thing that
 * trusted the number, starting with whether the voiceover fits.
 *
 * Pure: no DB, no ffmpeg, no clock.
 */

export type ClipTransition = "cut" | "dissolve";

export interface PlanClip {
  id: string;
  position: number;
  trimStartMs: number;
  trimEndMs: number;
  transitionIn: ClipTransition;
  /**
   * Set when the thing this clip pointed at was deleted underneath it.
   *
   * The clip keeps its slot and its trim so the timeline does not silently
   * reshuffle around a hole, but the sequence cannot render until somebody
   * replaces or removes it.
   */
  sourceMissingAt?: Date | string | null;
}

/**
 * How long a dissolve lasts.
 *
 * 500ms: long enough to read as deliberate, short enough not to eat a sixth of
 * a 6s clip. Not configurable per clip, because doc 21's model has no field for
 * it and adding one would be the "rest" Principle 1.16 forbids.
 */
export const DISSOLVE_MS = 500;

export interface PlannedClip extends PlanClip {
  /** Length after trimming, before any overlap is taken off. */
  durationMs: number;
  /** True when the source is gone. The slot is kept; the render is refused. */
  sourceMissing: boolean;
  /** Where this clip's first frame lands in the finished video. */
  timelineStartMs: number;
  /** Overlap with the previous clip. Zero for a cut, and for the first clip. */
  overlapMs: number;
}

export interface SequencePlan {
  clips: PlannedClip[];
  totalDurationMs: number;
  /**
   * False when at least one clip has lost its source.
   *
   * Deliberately separate from `warnings`: a shortened dissolve is worth
   * mentioning and still renders, whereas this cannot render at all, and a
   * surface that treated the two the same would let somebody press Render on a
   * sequence that is going to fail.
   */
  renderable: boolean;
  /** The ffmpeg graph, empty when there is nothing or only one clip to join. */
  filterComplex: string;
  outputLabel: string;
  warnings: string[];
}

/**
 * Order, trim, and lay the clips on a timeline.
 *
 * Clips are sorted by `position` rather than trusted to arrive in order: the
 * unique constraint guarantees positions do not collide, not that a caller
 * selected with an ORDER BY.
 */
export function buildSequencePlan(clips: readonly PlanClip[]): SequencePlan {
  const warnings: string[] = [];
  const ordered = [...clips].sort((a, b) => a.position - b.position);

  const planned: PlannedClip[] = [];
  let cursor = 0;

  ordered.forEach((clip, i) => {
    const durationMs = clip.trimEndMs - clip.trimStartMs;

    let overlapMs = 0;
    if (i > 0 && clip.transitionIn === "dissolve") {
      const previous = planned[i - 1];
      /*
       * A dissolve cannot be longer than either clip it joins. Two very short
       * clips with a full-length dissolve would otherwise produce a negative
       * segment and an ffmpeg graph that fails at render time rather than here.
       */
      const room = Math.min(previous.durationMs, durationMs);
      overlapMs = Math.min(DISSOLVE_MS, Math.max(0, room - 1));
      if (overlapMs < DISSOLVE_MS) {
        warnings.push(
          `The dissolve into clip ${i + 1} was shortened to ${overlapMs}ms because the clips on ` +
          `either side are too short for a full ${DISSOLVE_MS}ms crossfade.`,
        );
      }
    }

    const sourceMissing = Boolean(clip.sourceMissingAt);
    if (sourceMissing) {
      warnings.push(
        `Clip ${i + 1} has lost the file it pointed at, so this sequence cannot render. ` +
        `Replace it or remove it.`,
      );
    }

    const timelineStartMs = i === 0 ? 0 : cursor - overlapMs;
    planned.push({ ...clip, durationMs, sourceMissing, timelineStartMs, overlapMs });
    cursor = timelineStartMs + durationMs;
  });

  if (planned.length === 0) {
    return { clips: [], totalDurationMs: 0, renderable: true, filterComplex: "", outputLabel: "", warnings };
  }

  const renderable = planned.every(c => !c.sourceMissing);

  return {
    clips: planned,
    totalDurationMs: cursor,
    renderable,
    /*
     * No graph for a sequence that cannot render. Emitting one would produce a
     * command referencing a file that is not there, and the failure would
     * arrive from ffmpeg rather than from the thing that knows why.
     */
    ...(renderable
      ? buildFilterGraph(planned)
      : { filterComplex: "", outputLabel: "" }),
    warnings,
  };
}

/**
 * The ffmpeg graph.
 *
 * Each input is trimmed and reset to a zero timebase, then joined left to
 * right. `xfade` needs an OFFSET measured in the accumulated output, not in the
 * incoming clip, which is the detail that makes hand-written concat graphs go
 * wrong when there are more than two clips.
 */
function buildFilterGraph(clips: readonly PlannedClip[]): { filterComplex: string; outputLabel: string } {
  const secs = (ms: number): string => (ms / 1000).toFixed(3);
  const parts: string[] = [];

  clips.forEach((c, i) => {
    parts.push(
      `[${i}:v]trim=start=${secs(c.trimStartMs)}:end=${secs(c.trimEndMs)},setpts=PTS-STARTPTS[v${i}]`,
    );
  });

  if (clips.length === 1) {
    return { filterComplex: parts.join(";"), outputLabel: "v0" };
  }

  let carry = "v0";
  let carryDurationMs = clips[0].durationMs;

  for (let i = 1; i < clips.length; i += 1) {
    const clip = clips[i];
    const label = `x${i}`;
    if (clip.overlapMs > 0) {
      const offsetMs = carryDurationMs - clip.overlapMs;
      parts.push(
        `[${carry}][v${i}]xfade=transition=fade:duration=${secs(clip.overlapMs)}:` +
        `offset=${secs(offsetMs)}[${label}]`,
      );
      carryDurationMs = carryDurationMs - clip.overlapMs + clip.durationMs;
    } else {
      parts.push(`[${carry}][v${i}]concat=n=2:v=1:a=0[${label}]`);
      carryDurationMs += clip.durationMs;
    }
    carry = label;
  }

  return { filterComplex: parts.join(";"), outputLabel: carry };
}

/** The line the timeline shows above the clips. One place, one wording. */
export function describeSequence(plan: SequencePlan): string {
  if (plan.clips.length === 0) return "No clips yet, so there is nothing to assemble.";
  const seconds = (plan.totalDurationMs / 1000).toFixed(1);
  const dissolves = plan.clips.filter(c => c.overlapMs > 0).length;
  const clipWord = plan.clips.length === 1 ? "clip" : "clips";
  if (dissolves === 0) return `${plan.clips.length} ${clipWord}, ${seconds}s in total.`;
  return `${plan.clips.length} ${clipWord}, ${seconds}s in total, with ${dissolves} ` +
    `dissolve${dissolves === 1 ? "" : "s"} overlapping the cuts.`;
}
