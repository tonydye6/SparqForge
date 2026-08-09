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
 * Pure by design: no DB, no clock, no model call. The caller supplies the posts.
 * That is what makes every threshold below testable, and every one of them is a
 * judgement that deserves to be argued with.
 *
 * ---
 *
 * **EVERY `appliesTo` HERE NAMES A COLUMN THAT EXISTS.** The first version of
 * this file emitted `brand_schedule_profiles.preferredDayPart`, and there is no
 * such field: that table is a per-hour grid keyed
 * `(brandId, platform, dayOfWeek, hour)` with `score` and `status`, and it is
 * what `smart-schedule.ts` actually reads. An offer to write a column that does
 * not exist is worse than no offer, because the card would state a consequence
 * the Apply button could never deliver — which is precisely the "shows you
 * something that is not really there" failure doc 24 §2.2 calls worse than
 * showing nothing. Each target below was read out of the schema first:
 *
 *  - `window`       → `brand_schedule_profiles` rows, per platform, per hour
 *  - `persona`      → `brands.defaultPersonaId` (M1)
 *  - `composition`  → `brands.compositionRules` (via `performance-learning.ts`)
 *  - `disagreement` → nothing, deliberately
 */
import type { ConclusionKind, ConclusionConfidence } from "@workspace/db/schema";

export interface ConclusionPost {
  calendarEntryId: string;
  /**
   * Which channel it went out on. Required, because the schedule profile this
   * eventually writes is keyed by platform: a finding pooled across channels
   * could not be applied to any of them without inventing a claim about each.
   */
  platform: string;
  /** Latest engagement total for the post. */
  engagements: number;
  /** When it went out. Null means it cannot inform a window conclusion. */
  publishedAt: Date | null;
  /** Milliseconds between approval requested and decided, when both are known. */
  approvalLatencyMs?: number | null;
  /** The director behind the variant, from `creative_variants.personaId`. */
  personaId?: string | null;
  /** For the sentence. Falls back to the id when the persona has been deleted. */
  personaName?: string | null;
  /**
   * `creative_variants.headlineRenderMode`: "rendered" when the image model
   * painted the headline into the scene, "overlay" when the compositor laid it
   * on top. **The one compositional choice that is genuinely linked to a
   * published post today** — see `compositionConclusions` for why the richer
   * ones are not, and what would have to exist first.
   */
  headlineRenderMode?: string | null;
}

export interface DerivedConclusion {
  /**
   * Stable across re-derivations of the same finding.
   *
   * Without it the scheduled job re-proposes every conclusion on every run: the
   * surface fills with duplicates, and dismissing one achieves nothing because
   * the next pass puts it straight back. `brands.compositionRules` already
   * learned this and carries `conclusionId` for exactly the same reason.
   * Deliberately derived from WHAT the finding is about, never from its numbers,
   * so a finding that strengthens week to week stays the same finding.
   */
  key: string;
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

/** Matches `brands.timezone`'s own default, so the two cannot disagree. */
export const DEFAULT_TIME_ZONE = "America/New_York";

/**
 * Day-parts, and the hours each one owns.
 *
 * `hours` is not decoration: it is what the schedule-profile write iterates, so
 * the label a person reads and the rows the Apply button touches come from one
 * definition and cannot drift into disagreeing about when "the evening" is.
 */
export const DAY_PARTS = [
  { key: "morning", label: "mornings", from: 5, to: 11 },
  { key: "midday", label: "midday", from: 11, to: 14 },
  { key: "afternoon", label: "afternoons", from: 14, to: 17 },
  { key: "evening", label: "evenings", from: 17, to: 22 },
  { key: "night", label: "late night", from: 22, to: 29 },
] as const;

/** The real clock hours a day-part covers, with the post-midnight wrap undone. */
export function hoursInDayPart(key: string): number[] {
  const part = DAY_PARTS.find(p => p.key === key);
  if (!part) return [];
  const out: number[] = [];
  for (let h = part.from; h < part.to; h += 1) out.push(h % 24);
  return out;
}

/**
 * The wall-clock hour of an instant, in a named zone.
 *
 * **This is not a detail, it is a correctness bug that was live.** `published_at`
 * is `timestamp without time zone` and the pg driver parses it as UTC, so
 * `getHours()` returned the hour in whatever zone the SERVER happened to be in.
 * Verified rather than reasoned about: a post seeded at 19:00 read back as
 * `getHours() === 12` on a Los Angeles machine, and a spread deliberately built
 * as "evenings beat mornings" was reported as a midday finding.
 *
 * A posting-time conclusion whose hour depends on where the process is running
 * is worthless, because the row it writes into `brand_schedule_profiles` is read
 * by a human thinking in their brand's own clock. `brands.timezone` is that
 * clock, it already exists, and it is what this uses.
 *
 * Intl rather than a date library: no new dependency, correct across DST, and
 * `hour12: false` can render midnight as "24" in some ICU builds, hence the
 * modulo.
 */
export function hourInZone(d: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", hour12: false,
  }).format(d);
  return Number(formatted) % 24;
}

function dayPart(d: Date, timeZone: string): { key: string; label: string } {
  const hour = hourInZone(d, timeZone);
  const h = hour < 5 ? hour + 24 : hour;
  return DAY_PARTS.find(p => h >= p.from && h < p.to) ?? DAY_PARTS[4];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Group by a key, dropping nothing. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * Compare one group against everything else, and report only a real gap.
 *
 * Against the REST rather than against the overall mean, because a bucket
 * holding most of the posts would otherwise be compared largely against itself
 * and could never clear the threshold however well it did.
 *
 * Returns null whenever either side is too thin or the gap too small, which is
 * most of the time and is the point.
 */
function liftAgainstRest(
  group: readonly ConclusionPost[],
  rest: readonly ConclusionPost[],
): number | null {
  if (group.length < MIN_SAMPLE || rest.length < MIN_SAMPLE) return null;
  const inside = mean(group.map(p => p.engagements));
  const outside = mean(rest.map(p => p.engagements));
  if (outside <= 0) return null;
  const effect = inside / outside;
  return effect >= MIN_EFFECT ? effect : null;
}

/**
 * A posting window that outperforms the rest, **per platform**.
 *
 * Per platform because that is the shape of the thing it would write. A finding
 * that pooled Instagram and X could name no platform when applied, and
 * `brand_schedule_profiles` has no row that means "everywhere".
 */
export function windowConclusions(
  posts: readonly ConclusionPost[],
  timeZone: string = DEFAULT_TIME_ZONE,
): DerivedConclusion[] {
  const dated = posts.filter(p => p.publishedAt !== null);
  const out: DerivedConclusion[] = [];

  for (const [platform, platformPosts] of groupBy(dated, p => p.platform)) {
    if (platformPosts.length < MIN_SAMPLE * 2) continue;

    for (const [key, bucket] of groupBy(platformPosts, p => dayPart(p.publishedAt!, timeZone).key)) {
      const rest = platformPosts.filter(p => dayPart(p.publishedAt!, timeZone).key !== key);
      const effect = liftAgainstRest(bucket, rest);
      if (effect === null) continue;

      const label = DAY_PARTS.find(p => p.key === key)?.label ?? key;
      const hours = hoursInDayPart(key);
      out.push({
        key: `window:${platform}:${key}`,
        kind: "window",
        statement:
          `On ${platform}, posts published in the ${label} average ${effect.toFixed(1)}x the ` +
          `engagement of posts at other times.`,
        evidence: {
          n: bucket.length,
          metric: "engagements",
          effectSize: Number(effect.toFixed(2)),
          entryIds: bucket.map(p => p.calendarEntryId),
        },
        confidence: confidenceFor(bucket.length),
        /*
         * `status` is the field a person would change by hand on the schedule
         * screen, and "preferred" is the value that screen already uses. The
         * write marks every hour of the day-part, on all seven days, because a
         * day-part finding says nothing about which day and pretending otherwise
         * would be inventing precision the evidence does not have.
         */
        appliesTo: {
          table: "brand_schedule_profiles",
          field: "status",
          value: { platform, dayPart: key, hours, status: "preferred", score: 0.9 },
        },
      });
    }
  }

  return out.sort((a, b) => b.evidence.effectSize - a.evidence.effectSize);
}

/**
 * A director whose work outperforms the rest.
 *
 * The write is `brands.defaultPersonaId`, which M1 added for exactly this and
 * which stage 02 reads to decide which card is locked in as the brand default.
 *
 * **Doc 22 item 4 says "designer_personas ranking" and there is no such
 * column** — `designer_personas` carries no brand, no rank and no default flag;
 * M1 deliberately put the default on the brand instead, because a persona is
 * account-scoped and can be the default for one brand and not another. So the
 * plan's wording is stale and the brand column is the real target.
 */
export function personaConclusions(posts: readonly ConclusionPost[]): DerivedConclusion[] {
  const attributed = posts.filter(p => typeof p.personaId === "string" && p.personaId.length > 0);
  if (attributed.length < MIN_SAMPLE * 2) return [];

  const out: DerivedConclusion[] = [];
  for (const [personaId, group] of groupBy(attributed, p => p.personaId!)) {
    const rest = attributed.filter(p => p.personaId !== personaId);
    const effect = liftAgainstRest(group, rest);
    if (effect === null) continue;

    const name = group.find(p => p.personaName)?.personaName ?? personaId;
    out.push({
      key: `persona:${personaId}`,
      kind: "persona",
      statement:
        `Work directed by ${name} averages ${effect.toFixed(1)}x the engagement of work by the ` +
        `other directors on this brand.`,
      evidence: {
        n: group.length,
        metric: "engagements",
        effectSize: Number(effect.toFixed(2)),
        entryIds: group.map(p => p.calendarEntryId),
      },
      confidence: confidenceFor(group.length),
      appliesTo: { table: "brands", field: "defaultPersonaId", value: personaId },
    });
  }
  return out.sort((a, b) => b.evidence.effectSize - a.evidence.effectSize);
}

/** How the headline got onto the image, in the words the rule will use. */
const HEADLINE_MODE_PROSE: Record<string, string> = {
  rendered: "headline typography painted into the image by the model",
  overlay: "headline typography laid over the image as a text layer",
};

/**
 * A compositional choice that correlates with performance.
 *
 * **This reads ONE attribute, and the narrowness is the honest part.** The
 * richer compositional facts — a take's position on the Explore axes, its
 * region edits, its drift — live on `stage_takes.payload`, and there is no path
 * from a published post back to them: `calendar_entries.variantId` points at a
 * `creative_variants` row, and `POST /creatives/:id/use-take` promotes a take
 * WITHOUT creating a variant. Checked in `routes/copy.ts` rather than assumed.
 * Until the v2 spine's output becomes a variant, an axis conclusion would have
 * to guess at the join, and a conclusion that guesses is the thing this table
 * exists to stop.
 *
 * `headlineRenderMode` survives that gap because it is a column ON the variant,
 * so the link is a field read rather than a join nobody built. It is also a
 * choice worth having an opinion about: doc 24 §7 says to prefer overlay, and
 * this is the only thing in the app that could ever say whether that was right.
 */
export function compositionConclusions(posts: readonly ConclusionPost[]): DerivedConclusion[] {
  const withMode = posts.filter(
    p => typeof p.headlineRenderMode === "string" && p.headlineRenderMode in HEADLINE_MODE_PROSE,
  );
  if (withMode.length < MIN_SAMPLE * 2) return [];

  const out: DerivedConclusion[] = [];
  for (const [mode, group] of groupBy(withMode, p => p.headlineRenderMode!)) {
    const rest = withMode.filter(p => p.headlineRenderMode !== mode);
    const effect = liftAgainstRest(group, rest);
    if (effect === null) continue;

    const prose = HEADLINE_MODE_PROSE[mode];
    out.push({
      key: `composition:headlineRenderMode:${mode}`,
      kind: "composition",
      statement:
        `Posts with the ${prose} average ${effect.toFixed(1)}x the engagement of the other ` +
        `treatment.`,
      evidence: {
        n: group.length,
        metric: "engagements",
        effectSize: Number(effect.toFixed(2)),
        entryIds: group.map(p => p.calendarEntryId),
      },
      confidence: confidenceFor(group.length),
      /*
       * The value is the RULE TEXT, written the way it will read inside the
       * brand contract, because that is what applying it appends. The rule is
       * phrased as an instruction rather than as a statistic: the model reads
       * this sentence, and "averages 1.4x engagement" is not something it can
       * act on.
       */
      appliesTo: {
        table: "brands",
        field: "compositionRules",
        value: { rule: `Prefer ${prose}.` },
      },
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
    key: "disagreement:approval-latency",
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

/**
 * Every conclusion derivable from a set of scored posts.
 *
 * `timeZone` is the brand's, and only the window kind reads it. Defaulted rather
 * than required so the three time-blind kinds stay callable without one, but the
 * job always passes the real value.
 */
export function deriveConclusions(
  posts: readonly ConclusionPost[],
  timeZone: string = DEFAULT_TIME_ZONE,
): DerivedConclusion[] {
  return [
    ...windowConclusions(posts, timeZone),
    ...personaConclusions(posts),
    ...compositionConclusions(posts),
    ...disagreementConclusions(posts),
  ];
}
