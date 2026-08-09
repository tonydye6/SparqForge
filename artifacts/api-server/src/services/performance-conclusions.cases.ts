/**
 * Assertions for the conclusions layer. Pure, so every threshold argued for in
 * `performance-conclusions.ts` can be held to it.
 *
 * The cases that matter most are the ones where the answer is SILENCE: thin
 * samples and small effects must produce nothing. A surface that reports a 4%
 * lift off four posts is one people learn to ignore, and then the real finding
 * arrives and gets ignored too.
 */
import {
  confidenceFor,
  deriveConclusions,
  disagreementConclusions,
  windowConclusions,
  MIN_SAMPLE,
  MIN_EFFECT,
  type ConclusionPost,
} from "./performance-conclusions.js";

const at = (hour: number, engagements: number, id: string): ConclusionPost => ({
  calendarEntryId: id,
  engagements,
  publishedAt: new Date(2026, 0, 5, hour, 0, 0),
});

const approved = (latencyMs: number, engagements: number, id: string): ConclusionPost => ({
  calendarEntryId: id,
  engagements,
  publishedAt: null,
  approvalLatencyMs: latencyMs,
});

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- confidence never claims more than the sample supports ----
  check("under 3 is low", confidenceFor(2) === "low");
  check("3 to 9 is medium", confidenceFor(3) === "medium" && confidenceFor(9) === "medium");
  check("10 or more is high", confidenceFor(10) === "high");

  // ---- windows ----
  {
    // Six evening posts at 100, six morning posts at 20. A real 5x split.
    const posts = [
      ...[1, 2, 3, 4, 5, 6].map(i => at(19, 100, `e${i}`)),
      ...[1, 2, 3, 4, 5, 6].map(i => at(8, 20, `m${i}`)),
    ];
    const out = windowConclusions(posts);
    const evening = out.find(c => c.statement.includes("evening"));
    check("a real split produces a window conclusion", !!evening, out);
    check("evidence.n is the bucket size", evening?.evidence.n === 6, evening?.evidence);
    check("effect size is reported", (evening?.evidence.effectSize ?? 0) >= 5, evening?.evidence);
    check("it knows what it would write",
      evening?.appliesTo?.table === "brand_schedule_profiles", evening?.appliesTo);
    check("entryIds name the posts behind it",
      evening?.evidence.entryIds.length === 6, evening?.evidence.entryIds);
    check("confidence is medium at n=6", evening?.confidence === "medium", evening?.confidence);
  }
  {
    // The same shape, but the difference is 10%. Must say nothing.
    const posts = [
      ...[1, 2, 3, 4, 5, 6].map(i => at(19, 110, `e${i}`)),
      ...[1, 2, 3, 4, 5, 6].map(i => at(8, 100, `m${i}`)),
    ];
    check("a 1.1x difference is not a finding", windowConclusions(posts).length === 0);
  }
  {
    // Two posts in the winning bucket. Below MIN_SAMPLE, so silence.
    const posts = [
      ...[1, 2].map(i => at(19, 500, `e${i}`)),
      ...[1, 2, 3, 4].map(i => at(8, 10, `m${i}`)),
    ];
    check("a two-post bucket produces nothing", windowConclusions(posts).length === 0);
  }
  {
    check("no posts, no conclusions", windowConclusions([]).length === 0);
    check("undated posts cannot inform a window",
      windowConclusions([approved(1, 100, "a"), approved(2, 100, "b")]).length === 0);
  }

  // ---- disagreement ----
  {
    // Nine posts. The three approved fastest do far worse.
    const posts = [
      approved(60_000, 10, "f1"), approved(70_000, 12, "f2"), approved(80_000, 8, "f3"),
      approved(5_000_000, 100, "s1"), approved(6_000_000, 110, "s2"), approved(7_000_000, 90, "s3"),
      approved(8_000_000, 120, "s4"), approved(9_000_000, 95, "s5"), approved(10_000_000, 105, "s6"),
    ];
    const out = disagreementConclusions(posts);
    check("fastest-approved underperforming is reported", out.length === 1, out);
    check("it is the disagreement kind", out[0]?.kind === "disagreement");
    check("evidence.n is the fast group", out[0]?.evidence.n === 3, out[0]?.evidence);
    /*
     * The one that keeps this table honest: a disagreement has NOTHING to
     * apply. M6's CHECK makes an applied conclusion without a write impossible,
     * so a null here is what confines this card to acknowledge-or-dismiss.
     */
    check("a disagreement has nothing to apply", out[0]?.appliesTo === null, out[0]?.appliesTo);
  }
  {
    // Fastest approvals did BETTER. No disagreement to report.
    const posts = [
      approved(60_000, 100, "f1"), approved(70_000, 110, "f2"), approved(80_000, 120, "f3"),
      approved(5_000_000, 10, "s1"), approved(6_000_000, 12, "s2"), approved(7_000_000, 9, "s3"),
    ];
    check("agreement is not a finding", disagreementConclusions(posts).length === 0);
  }
  {
    // Slightly worse, but inside the threshold. Silence.
    const posts = [
      approved(1, 95, "f1"), approved(2, 96, "f2"), approved(3, 94, "f3"),
      approved(9, 100, "s1"), approved(10, 101, "s2"), approved(11, 99, "s3"),
    ];
    check("a small gap is not a disagreement", disagreementConclusions(posts).length === 0);
  }
  {
    check("posts with no approval timing produce nothing",
      disagreementConclusions([at(19, 10, "a"), at(20, 10, "b")]).length === 0);
  }

  // ---- the combined entry point ----
  {
    const posts = [
      ...[1, 2, 3, 4, 5, 6].map(i => at(19, 100, `e${i}`)),
      ...[1, 2, 3, 4, 5, 6].map(i => at(8, 20, `m${i}`)),
    ];
    check("deriveConclusions returns the window finding", deriveConclusions(posts).length >= 1);
    check("every conclusion carries a positive n",
      deriveConclusions(posts).every(c => c.evidence.n > 0));
    check("every conclusion names its metric",
      deriveConclusions(posts).every(c => c.evidence.metric.length > 0));
  }

  check("thresholds are the documented ones", MIN_SAMPLE === 3 && MIN_EFFECT === 1.25);

  return results;
}
