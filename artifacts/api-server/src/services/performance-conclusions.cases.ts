/**
 * Assertions for the conclusions layer. Pure, so every threshold argued for in
 * `performance-conclusions.ts` can be held to it.
 *
 * The cases that matter most are the ones where the answer is SILENCE: thin
 * samples and small effects must produce nothing. A surface that reports a 4%
 * lift off four posts is one people learn to ignore, and then the real finding
 * arrives and gets ignored too.
 *
 * The second group that matters is the `appliesTo` group. Those assertions pin
 * each offer to a column that exists, because the defect they were written
 * against was a card offering to write `brand_schedule_profiles.preferredDayPart`
 * — a field this schema has never had.
 */
import {
  confidenceFor,
  compositionConclusions,
  deriveConclusions,
  disagreementConclusions,
  hourInZone,
  hoursInDayPart,
  personaConclusions,
  windowConclusions,
  MIN_SAMPLE,
  MIN_EFFECT,
  type ConclusionPost,
} from "./performance-conclusions.js";

/**
 * A post at a given LOCAL hour in the zone the window assertions use.
 *
 * `new Date(y, m, d, h)` builds the instant in the machine's own zone, which is
 * exactly the assumption that produced the bug these cases now guard: the
 * derivation must read the hour in the BRAND's zone. Building the instant from
 * an explicit UTC offset keeps the assertions true on any machine.
 */
const TEST_ZONE = "America/New_York";
const at = (
  hour: number,
  engagements: number,
  id: string,
  platform = "instagram_feed",
): ConclusionPost => ({
  calendarEntryId: id,
  platform,
  engagements,
  // January, so New York is UTC-5 with no DST ambiguity.
  publishedAt: new Date(Date.UTC(2026, 0, 5, hour + 5, 0, 0)),
});

const approved = (latencyMs: number, engagements: number, id: string): ConclusionPost => ({
  calendarEntryId: id,
  platform: "instagram_feed",
  engagements,
  publishedAt: null,
  approvalLatencyMs: latencyMs,
});

const byPersona = (
  personaId: string,
  engagements: number,
  id: string,
  personaName?: string,
): ConclusionPost => ({
  calendarEntryId: id,
  platform: "instagram_feed",
  engagements,
  publishedAt: null,
  personaId,
  personaName,
});

const withHeadline = (mode: string, engagements: number, id: string): ConclusionPost => ({
  calendarEntryId: id,
  platform: "instagram_feed",
  engagements,
  publishedAt: null,
  headlineRenderMode: mode,
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
    const out = windowConclusions(posts, TEST_ZONE);
    const evening = out.find(c => c.statement.includes("evening"));
    check("a real split produces a window conclusion", !!evening, out);
    check("evidence.n is the bucket size", evening?.evidence.n === 6, evening?.evidence);
    check("effect size is reported", (evening?.evidence.effectSize ?? 0) >= 5, evening?.evidence);
    check("entryIds name the posts behind it",
      evening?.evidence.entryIds.length === 6, evening?.evidence.entryIds);
    check("confidence is medium at n=6", evening?.confidence === "medium", evening?.confidence);

    /*
     * THE ASSERTION THIS FILE EXISTS FOR. The write must name a real column on
     * a real table, and carry the platform and the hours it would touch — an
     * offer that cannot be executed is a lie on a card.
     */
    const applies = evening?.appliesTo;
    check("it writes to the schedule profile table",
      applies?.table === "brand_schedule_profiles", applies);
    check("it writes a column that exists",
      applies?.field === "status", applies);
    const value = applies?.value as { platform?: string; hours?: number[]; status?: string } | undefined;
    check("the write names its platform", value?.platform === "instagram_feed", value);
    check("the write names the hours it would mark",
      Array.isArray(value?.hours) && value!.hours!.length === 5, value);
    check("the write uses a status the schedule screen accepts",
      value?.status === "preferred", value);
    check("the statement names the platform",
      evening?.statement.includes("instagram_feed") === true, evening?.statement);
    check("the key is stable and describes the finding",
      evening?.key === "window:instagram_feed:evening", evening?.key);
  }
  {
    // The same shape, but the difference is 10%. Must say nothing.
    const posts = [
      ...[1, 2, 3, 4, 5, 6].map(i => at(19, 110, `e${i}`)),
      ...[1, 2, 3, 4, 5, 6].map(i => at(8, 100, `m${i}`)),
    ];
    check("a 1.1x difference is not a finding", windowConclusions(posts, TEST_ZONE).length === 0);
  }
  {
    // Two posts in the winning bucket. Below MIN_SAMPLE, so silence.
    const posts = [
      ...[1, 2].map(i => at(19, 500, `e${i}`)),
      ...[1, 2, 3, 4].map(i => at(8, 10, `m${i}`)),
    ];
    check("a two-post bucket produces nothing", windowConclusions(posts, TEST_ZONE).length === 0);
  }
  {
    /*
     * Twelve posts across two channels, each channel holding a real split and
     * enough posts to stand on its own. Two findings, not one pooled one: each
     * has to name a platform, because the row it would write is keyed by one.
     */
    const posts = [
      ...[1, 2, 3].map(i => at(19, 100, `e${i}`, "instagram_feed")),
      ...[1, 2, 3].map(i => at(8, 20, `m${i}`, "instagram_feed")),
      ...[1, 2, 3].map(i => at(19, 100, `xe${i}`, "twitter")),
      ...[1, 2, 3].map(i => at(8, 20, `xm${i}`, "twitter")),
    ];
    const out = windowConclusions(posts, TEST_ZONE);
    check("each channel gets its own finding", out.length === 2, out);
    check("the two findings name different platforms",
      new Set(out.map(c => (c.appliesTo?.value as { platform: string }).platform)).size === 2, out);
    check("neither finding borrows the other's posts",
      out.every(c => c.evidence.n === 3), out.map(c => c.evidence.n));
  }
  {
    /*
     * The same split, but each channel now holds four posts. Neither has the
     * six a window finding needs, and pooling them into one twelve-post claim
     * would manufacture a finding that could be applied to neither. Silence.
     */
    const posts = [
      ...[1, 2].map(i => at(19, 100, `e${i}`, "instagram_feed")),
      ...[1, 2].map(i => at(8, 20, `m${i}`, "instagram_feed")),
      ...[1, 2].map(i => at(19, 100, `xe${i}`, "twitter")),
      ...[1, 2].map(i => at(8, 20, `xm${i}`, "twitter")),
    ];
    check("channels too thin on their own are not pooled",
      windowConclusions(posts, TEST_ZONE).length === 0, windowConclusions(posts, TEST_ZONE));
  }
  {
    check("no posts, no conclusions", windowConclusions([], TEST_ZONE).length === 0);
    check("undated posts cannot inform a window",
      windowConclusions([approved(1, 100, "a"), approved(2, 100, "b")], TEST_ZONE).length === 0);
  }
  {
    /*
     * THE TIMEZONE CASE. The same twelve instants, read in two zones, must
     * produce two different findings — because they genuinely are two different
     * findings to the people in those places.
     *
     * This is the assertion that would have caught the live bug: the derivation
     * read `getHours()`, so its answer depended on where the server ran. A
     * spread seeded as evenings-beat-mornings came back reported as midday.
     */
    const posts = [
      ...[1, 2, 3, 4, 5, 6].map(i => at(19, 100, `e${i}`)),
      ...[1, 2, 3, 4, 5, 6].map(i => at(8, 20, `m${i}`)),
    ];
    const ny = windowConclusions(posts, "America/New_York")[0];
    // 19:00 in New York is 16:00 in Los Angeles, which is the afternoon.
    const la = windowConclusions(posts, "America/Los_Angeles")[0];
    check("the same posts read as evening in New York",
      ny?.key === "window:instagram_feed:evening", ny?.key);
    check("and as afternoon in Los Angeles",
      la?.key === "window:instagram_feed:afternoon", la?.key);
    check("the hour used is the zone's, not the machine's",
      hourInZone(new Date(Date.UTC(2026, 0, 5, 0, 30)), "America/New_York") === 19,
      hourInZone(new Date(Date.UTC(2026, 0, 5, 0, 30)), "America/New_York"));
    check("midnight in zone reads as 0, never 24",
      hourInZone(new Date(Date.UTC(2026, 0, 5, 5, 0)), "America/New_York") === 0,
      hourInZone(new Date(Date.UTC(2026, 0, 5, 5, 0)), "America/New_York"));
  }
  {
    check("evenings cover 17:00 to 21:00", hoursInDayPart("evening").join(",") === "17,18,19,20,21");
    // The wrap is the case that breaks naive hour maths: 22..28 is 22,23,0..4.
    check("late night wraps past midnight",
      hoursInDayPart("night").join(",") === "22,23,0,1,2,3,4", hoursInDayPart("night"));
    check("an unknown day-part owns no hours", hoursInDayPart("brunch").length === 0);
  }

  // ---- personas ----
  {
    const posts = [
      ...[1, 2, 3, 4].map(i => byPersona("p-ava", 100, `a${i}`, "Ava K")),
      ...[1, 2, 3, 4].map(i => byPersona("p-house", 20, `h${i}`, "House style")),
    ];
    const out = personaConclusions(posts);
    const ava = out[0];
    check("a director who outperforms is reported", out.length === 1, out);
    check("the sentence uses the director's name",
      ava?.statement.includes("Ava K"), ava?.statement);
    check("it offers to make them the brand default",
      ava?.appliesTo?.table === "brands" && ava?.appliesTo?.field === "defaultPersonaId",
      ava?.appliesTo);
    check("the value is the persona id", ava?.appliesTo?.value === "p-ava", ava?.appliesTo);
    check("the key is the persona, not the numbers", ava?.key === "persona:p-ava", ava?.key);
  }
  {
    const posts = [
      ...[1, 2, 3, 4].map(i => byPersona("p-ava", 100, `a${i}`)),
      ...[1, 2, 3, 4].map(i => byPersona("p-house", 95, `h${i}`)),
    ];
    check("directors performing alike is not a finding", personaConclusions(posts).length === 0);
  }
  {
    check("posts with no director produce no persona finding",
      personaConclusions([at(19, 100, "a"), at(20, 100, "b")]).length === 0);
  }

  // ---- composition ----
  {
    const posts = [
      ...[1, 2, 3, 4].map(i => withHeadline("overlay", 100, `o${i}`)),
      ...[1, 2, 3, 4].map(i => withHeadline("rendered", 20, `r${i}`)),
    ];
    const out = compositionConclusions(posts);
    const overlay = out[0];
    check("a headline treatment that outperforms is reported", out.length === 1, out);
    check("it offers to append a brand composition rule",
      overlay?.appliesTo?.table === "brands" && overlay?.appliesTo?.field === "compositionRules",
      overlay?.appliesTo);
    /*
     * The rule is what the MODEL reads, so it has to be an instruction. A rule
     * that said "averages 5.0x engagement" would be a statistic pasted into a
     * prompt, and the model cannot act on a statistic.
     */
    const rule = (overlay?.appliesTo?.value as { rule?: string } | undefined)?.rule ?? "";
    check("the rule is phrased as an instruction", rule.startsWith("Prefer "), rule);
    check("the rule carries no numbers", !/\d/.test(rule), rule);
    check("the key names the attribute and the value",
      overlay?.key === "composition:headlineRenderMode:overlay", overlay?.key);
  }
  {
    // A mode nobody recognises must not become a rule telling the model to
    // prefer a word this app has never defined.
    const posts = [
      ...[1, 2, 3, 4].map(i => withHeadline("interpretive_dance", 100, `d${i}`)),
      ...[1, 2, 3, 4].map(i => withHeadline("overlay", 20, `o${i}`)),
    ];
    check("an unrecognised treatment is not turned into a rule",
      compositionConclusions(posts).length === 0, compositionConclusions(posts));
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
    check("deriveConclusions returns the window finding", deriveConclusions(posts, TEST_ZONE).length >= 1);
    check("every conclusion carries a positive n",
      deriveConclusions(posts, TEST_ZONE).every(c => c.evidence.n > 0));
    check("every conclusion names its metric",
      deriveConclusions(posts, TEST_ZONE).every(c => c.evidence.metric.length > 0));
    check("every conclusion carries a key",
      deriveConclusions(posts, TEST_ZONE).every(c => c.key.length > 0));
  }
  {
    /*
     * One set of posts carrying every signal at once. Keys must be unique, or
     * the upsert that stores them silently collapses two findings into one.
     */
    const posts: ConclusionPost[] = [
      ...[1, 2, 3, 4, 5, 6].map(i => ({
        ...at(19, 100, `e${i}`), personaId: "p-ava", personaName: "Ava K",
        headlineRenderMode: "overlay", approvalLatencyMs: 9_000_000,
      })),
      ...[1, 2, 3, 4, 5, 6].map(i => ({
        ...at(8, 20, `m${i}`), personaId: "p-house", personaName: "House style",
        headlineRenderMode: "rendered", approvalLatencyMs: 1_000,
      })),
    ];
    const all = deriveConclusions(posts, TEST_ZONE);
    const keys = all.map(c => c.key);
    check("keys are unique across kinds", new Set(keys).size === keys.length, keys);
    check("all four kinds can co-occur",
      new Set(all.map(c => c.kind)).size === 4, all.map(c => c.kind));
    check("only the disagreement lacks a write",
      all.filter(c => c.appliesTo === null).map(c => c.kind).join() === "disagreement",
      all.map(c => [c.kind, c.appliesTo === null]));
  }

  check("thresholds are the documented ones", MIN_SAMPLE === 3 && MIN_EFFECT === 1.25);

  return results;
}
