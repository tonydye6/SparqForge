/**
 * Assertions for sequence assembly.
 *
 * The arithmetic cases are the ones that matter. A dissolve borrows time rather
 * than adding it, and a reported duration that drifts from the rendered file
 * breaks everything downstream that trusted the number, starting with whether
 * the voiceover fits.
 */
import {
  buildSequencePlan,
  describeSequence,
  DISSOLVE_MS,
  type PlanClip,
} from "./sequence-plan.js";

const clip = (over: Partial<PlanClip> & { id: string; position: number }): PlanClip => ({
  trimStartMs: 0,
  trimEndMs: 6000,
  transitionIn: "cut",
  ...over,
});

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- the arithmetic ----
  {
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1 }),
    ]);
    check("two cut clips are the sum of their lengths", plan.totalDurationMs === 12_000, plan.totalDurationMs);
    check("the second starts where the first ends", plan.clips[1].timelineStartMs === 6000, plan.clips[1]);
    check("a cut has no overlap", plan.clips[1].overlapMs === 0, plan.clips[1]);
  }
  {
    /*
     * THE CASE THIS FILE EXISTS FOR. A dissolve OVERLAPS the clips, so two 6s
     * clips joined by a 500ms crossfade run 11.5s, not 12.
     */
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1, transitionIn: "dissolve" }),
    ]);
    check("a dissolve borrows time rather than adding it",
      plan.totalDurationMs === 12_000 - DISSOLVE_MS, plan.totalDurationMs);
    check("the second clip starts early by the dissolve",
      plan.clips[1].timelineStartMs === 6000 - DISSOLVE_MS, plan.clips[1]);
  }
  {
    // Three clips, two dissolves: the borrowing compounds.
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1, transitionIn: "dissolve" }),
      clip({ id: "c", position: 2, transitionIn: "dissolve" }),
    ]);
    check("two dissolves borrow twice",
      plan.totalDurationMs === 18_000 - 2 * DISSOLVE_MS, plan.totalDurationMs);
  }
  {
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0, trimStartMs: 1000, trimEndMs: 3000 }),
    ]);
    check("trim decides the length, not the source", plan.totalDurationMs === 2000, plan.totalDurationMs);
  }

  // ---- ordering ----
  {
    const plan = buildSequencePlan([
      clip({ id: "second", position: 1 }),
      clip({ id: "first", position: 0 }),
    ]);
    check("clips are ordered by position, not by arrival",
      plan.clips.map(c => c.id).join() === "first,second", plan.clips.map(c => c.id));
  }

  // ---- the short-clip guard ----
  {
    /*
     * Two clips shorter than the dissolve. Left alone this produces a negative
     * segment and a graph that fails at render time, which is the worst place
     * to find out.
     */
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0, trimEndMs: 300 }),
      clip({ id: "b", position: 1, trimEndMs: 300, transitionIn: "dissolve" }),
    ]);
    check("the dissolve is shortened rather than going negative",
      plan.clips[1].overlapMs > 0 && plan.clips[1].overlapMs < DISSOLVE_MS, plan.clips[1]);
    check("the total stays positive", plan.totalDurationMs > 0, plan.totalDurationMs);
    check("and the shortening is reported, not silent",
      plan.warnings.length === 1 && plan.warnings[0].includes("too short"), plan.warnings);
  }

  // ---- the graph ----
  {
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1, transitionIn: "dissolve" }),
    ]);
    check("each clip is trimmed", plan.filterComplex.includes("trim=start=0.000:end=6.000"), plan.filterComplex);
    check("and its timebase reset, or the join drifts",
      plan.filterComplex.includes("setpts=PTS-STARTPTS"), plan.filterComplex);
    check("the dissolve is an xfade", plan.filterComplex.includes("xfade=transition=fade"), plan.filterComplex);
    /*
     * xfade's offset is measured in the ACCUMULATED output, not in the incoming
     * clip. This is the detail that breaks hand-written graphs past two clips.
     */
    check("the crossfade offset is in output time", plan.filterComplex.includes("offset=5.500"), plan.filterComplex);
    check("the graph names its output", plan.outputLabel === "x1", plan.outputLabel);
  }
  {
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1 }),
      clip({ id: "c", position: 2 }),
    ]);
    check("three cuts concat left to right", (plan.filterComplex.match(/concat=n=2/g) ?? []).length === 2, plan.filterComplex);
    check("and the last label carries the result", plan.outputLabel === "x2", plan.outputLabel);
  }
  {
    const plan = buildSequencePlan([clip({ id: "only", position: 0 })]);
    check("a single clip needs no join", !plan.filterComplex.includes("concat"), plan.filterComplex);
    check("and is its own output", plan.outputLabel === "v0", plan.outputLabel);
  }
  {
    const plan = buildSequencePlan([]);
    check("no clips, no plan", plan.totalDurationMs === 0 && plan.filterComplex === "");
  }

  // ---- a clip whose source was deleted underneath it ----
  {
    /*
     * The decision: keep the slot, refuse the render. The alternative that was
     * accidentally in place refused the DELETE instead, with a constraint error
     * that never mentioned sequences.
     */
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "gone", position: 1, sourceMissingAt: "2026-08-09T10:00:00Z" }),
      clip({ id: "c", position: 2 }),
    ]);
    check("a broken clip keeps its slot", plan.clips.length === 3, plan.clips.length);
    check("and its place in the order", plan.clips[1].id === "gone", plan.clips.map(c => c.id));
    check("and its duration, so nothing silently reshuffles",
      plan.clips[1].durationMs === 6000 && plan.totalDurationMs === 18_000, plan.totalDurationMs);
    check("it is flagged", plan.clips[1].sourceMissing === true, plan.clips[1]);
    check("its neighbours are not", plan.clips[0].sourceMissing === false && plan.clips[2].sourceMissing === false);
    check("the sequence will not render", plan.renderable === false, plan.renderable);
    /*
     * No graph at all. Emitting one would produce a command pointing at a file
     * that is not there, so the failure would come from ffmpeg rather than from
     * the thing that knows why.
     */
    check("and no graph is offered", plan.filterComplex === "", plan.filterComplex);
    check("the reason names the clip and the fix",
      plan.warnings.some(w => w.includes("Clip 2") && w.includes("Replace it or remove it")), plan.warnings);
  }
  {
    const plan = buildSequencePlan([clip({ id: "a", position: 0 })]);
    check("an intact sequence renders", plan.renderable === true);
    check("and still has its graph", plan.filterComplex.length > 0);
  }
  {
    /*
     * Renderable is not the same as warning-free. A shortened dissolve is worth
     * saying and still renders; treating the two alike would let somebody press
     * Render on a sequence that is going to fail.
     */
    const plan = buildSequencePlan([
      clip({ id: "a", position: 0, trimEndMs: 300 }),
      clip({ id: "b", position: 1, trimEndMs: 300, transitionIn: "dissolve" }),
    ]);
    check("a warning alone does not block the render",
      plan.warnings.length > 0 && plan.renderable === true, [plan.warnings, plan.renderable]);
  }

  // ---- the line above the timeline ----
  {
    check("nothing to assemble says so", describeSequence(buildSequencePlan([])).includes("nothing to assemble"));
    const line = describeSequence(buildSequencePlan([
      clip({ id: "a", position: 0 }),
      clip({ id: "b", position: 1, transitionIn: "dissolve" }),
    ]));
    check("it reports the real total, not the naive one", line.includes("11.5s"), line);
    check("and mentions the dissolve", line.includes("dissolve"), line);
    check("no em dashes in product copy", !line.includes("—"), line);
  }

  return results;
}
