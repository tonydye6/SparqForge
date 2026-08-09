/**
 * Phase 8 · the conclusions layer.
 *
 * **What already existed, checked before building anything.** `performance-
 * insights.ts` aggregates `post_metrics` by intent, platform and day-part,
 * grades confidence by sample size, and mirrors into `signals`;
 * `PerformanceDashboard.tsx` renders it. Doc 24 §7 says "only the conclusions
 * layer and the UI are missing" — the UI is not missing, and the analysis is
 * not missing either. What is missing is a conclusion somebody can ACT on.
 *
 * So this file deliberately does NOT re-aggregate anything. It takes posts that
 * are already scored and turns them into decisions with a write attached.
 * Re-implementing existing machinery is doc 24 §5.1's first trap and it has
 * already cost this project the v2 Explore path.
 *
 * Pure by design: no DB, no clock, no model call. The caller supplies the posts
 * and the time. That is what makes the thresholds below testable at all, and
 * every one of them is a judgement that deserves to be argued with.
 */
import type { ConclusionKind, ConclusionConfidence } from "@workspace/db/schema";

export interface ConclusionPost {
  calendarEntryId: string;
  /** Latest engagement total for the post. */
  engagements: number;
  /** When it went out. Null means it cannot inform a window conclusion. */
  publishedAt: Date | null;
  /** Milliseconds between approval requested and decided, when both are known. */
  approvalLatencyMs?: number | null;
}

export interface DerivedConclusion {
  kind: ConclusionKind;
  statement: string;
  evidence: { n: number; metric: string; effectSize: number; entryIds: string[] };
  confidence: ConclusionConfidence;
  /** The write applying this would perform. Null when there is nothing to write. */
  appliesTo: { table: string; field: string; value: unknown } | null;
}

/**
 * The smallest sample that may produce a conclusion at all.
 *
 * Three is not a statistically respectable number and is not pretending to be.
 * It is the point below which a "conclusion" is obviously one or two posts
 * wearing a hat, and `confidence` carries the rest of the honesty. The existing
 * `confidenceForSample` in performance-insights uses the same shape, so the two
 * surfaces cannot disagree about what counts as thin.
 */
export const MIN_SAMPLE = 3;

/** Matches `confidenceForSample` in performance-insights.ts, minus "none". */
export function confidenceFor(n: number): ConclusionConfidence {
  if (n < 10) return n < 3 ? "low" : "medium";
  return "high";
}

/**
 * How much better a group must do before it is worth saying out loud.
 *
 * 1.25x. Below that, with samples this size, we would be reporting noise as a
 * finding — and a surface that cries wolf about a 4% lift teaches people to
 * ignore it, which costs more than staying quiet.
 */
export const MIN_EFFECT = 1.25;

const DAY_PARTS = [
  { key: "morning", label: "mornings", from: 5, to: 11 },
  { key: "midday", label: "midday", from: 11, to: 14 },
  { key: "afternoon", label: "afternoons", from: 14, to: 17 },
  { key: "evening", label: "evenings", from: 17, to: 22 },
  { key: "night", label: "late night", from: 22, to: 29 },
] as const;

function dayPart(d: Date): { key: string; label: string } {
  const h = d.getHours() < 5 ? d.getHours() + 24 : d.getHours();
  return DAY_PARTS.find(p => h >= p.from && h < p.to) ?? DAY_PARTS[4];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * A posting window that outperforms the rest.
 *
 * Compares each day-part against every OTHER post rather than against the
 * global mean, because a bucket holding most of the posts would otherwise be
 * compared largely against itself and could never clear the threshold.
 */
export function windowConclusions(posts: readonly ConclusionPost[]): DerivedConclusion[] {
  const dated = posts.filter(p => p.publishedAt !== null);
  if (dated.length < MIN_SAMPLE * 2) return [];

  const buckets = new Map<string, { label: string; posts: ConclusionPost[] }>();
  for (const p of dated) {
    const part = dayPart(p.publishedAt!);
    const b = buckets.get(part.key) ?? { label: part.label, posts: [] };
    b.posts.push(p);
    buckets.set(part.key, b);
  }

  const out: DerivedConclusion[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.posts.length < MIN_SAMPLE) continue;
    const rest = dated.filter(p => dayPart(p.publishedAt!).key !== key);
    if (rest.length < MIN_SAMPLE) continue;

    const inside = mean(bucket.posts.map(p => p.engagements));
    const outside = mean(rest.map(p => p.engagements));
    if (outside <= 0) continue;
    const effect = inside / outside;
    if (effect < MIN_EFFECT) continue;

    out.push({
      kind: "window",
      statement:
        `Posts published in the ${bucket.label} average ${effect.toFixed(1)}x the engagement ` +
        `of posts at other times.`,
      evidence: {
        n: bucket.posts.length,
        metric: "engagements",
        effectSize: Number(effect.toFixed(2)),
        entryIds: bucket.posts.map(p => p.calendarEntryId),
      },
      confidence: confidenceFor(bucket.posts.length),
      appliesTo: { table: "brand_schedule_profiles", field: "preferredDayPart", value: key },
    });
  }
  return out.sort((a, b) => b.evidence.effectSize - a.evidence.effectSize);
}

/**
 * The card that earns this table: **the work you approved fastest did worst.**
 *
 * Every other kind tells you about the work. This one tells you about the
 * judgement, which is the only thing here a person cannot get by staring
 * harder at their own numbers — and doc 20 §2.9's whole argument is that a
 * system which quietly retrains on you is one you cannot audit. So it says it
 * to your face instead.
 *
 * **It carries NO `appliesTo`, deliberately.** There is no setting to change:
 * the thing to adjust is a habit. The M6 CHECK makes an applied conclusion
 * without a write impossible, so this kind can only be acknowledged or
 * dismissed — which is the honest set of options for it.
 */
export function disagreementConclusions(posts: readonly ConclusionPost[]): DerivedConclusion[] {
  const timed = posts.filter(
    (p): p is ConclusionPost & { approvalLatencyMs: number } =>
      typeof p.approvalLatencyMs === "number" && p.approvalLatencyMs >= 0,
  );
  if (timed.length < MIN_SAMPLE * 2) return [];

  const byLatency = [...timed].sort((a, b) => a.approvalLatencyMs - b.approvalLatencyMs);
  // A third, floored at MIN_SAMPLE, so the comparison never rests on one post.
  const size = Math.max(MIN_SAMPLE, Math.floor(byLatency.length / 3));
  const fastest = byLatency.slice(0, size);
  const rest = byLatency.slice(size);
  if (rest.length < MIN_SAMPLE) return [];

  const fastMean = mean(fastest.map(p => p.engagements));
  const restMean = mean(rest.map(p => p.engagements));
  if (restMean <= 0) return [];

  // Only fires when the fast group is WORSE by the same margin we would demand
  // of a positive finding. Symmetry matters: a lower bar for bad news would
  // make this the surface's most alarming card and its least reliable one.
  const ratio = fastMean / restMean;
  if (ratio > 1 / MIN_EFFECT) return [];

  return [{
    kind: "disagreement",
    statement:
      `The ${fastest.length} posts you approved fastest averaged ` +
      `${(1 / ratio).toFixed(1)}x LESS engagement than the rest. Speed of approval and ` +
      `performance are pointing in opposite directions here.`,
    evidence: {
      n: fastest.length,
      metric: "engagements",
      effectSize: Number(ratio.toFixed(2)),
      entryIds: fastest.map(p => p.calendarEntryId),
    },
    confidence: confidenceFor(fastest.length),
    appliesTo: null,
  }];
}

/** Every conclusion derivable from a set of scored posts. */
export function deriveConclusions(posts: readonly ConclusionPost[]): DerivedConclusion[] {
  return [...windowConclusions(posts), ...disagreementConclusions(posts)];
}
