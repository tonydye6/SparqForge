/**
 * Phase 5 · what the brand learns from how its posts actually did.
 *
 * The record already accepts two kinds of automated proposal. Harvesting reads
 * the asset library's own colours; extraction reads the brand guide PDF. Both
 * follow the same shape, and it is the shape that matters rather than the
 * source: **propose a candidate, carry the evidence, let a human accept it, and
 * stamp where it came from.** An automated suggestion that wrote itself into the
 * record would be brand law nobody chose, which is the failure §1.17 exists to
 * prevent.
 *
 * This is the third source, and the one the other two were built to make room
 * for. A conclusion drawn from published performance arrives as a candidate
 * exactly like an extracted line does, and accepting it appends a rule to
 * `brands.compositionRules` stamped `learned`.
 *
 * **Where the halves divide.** Phase 8 owns DERIVING conclusions: the scheduled
 * job, the additional conclusion kinds, and the Performance surface. This file
 * owns the WRITE-BACK: the contract a conclusion must satisfy to be offered, the
 * guards that decide whether it may be, and what accepting one does to the
 * record. `conclusionsFromIntentInsights` below is one real producer built on
 * the evidence that exists today, so this is a path with something travelling
 * down it rather than a shape waiting for Phase 8.
 *
 * The evidence analogue of the guide's quote rule is the sample size. There, a
 * candidate the model could not quote was dropped because a value nobody can
 * trace back to the document is a guess wearing the guide's authority. Here, a
 * conclusion nobody can trace back to enough posts is a coincidence wearing
 * the same authority, and it is dropped for the same reason.
 *
 * Pure: no DB, no clock, no model call, no randomness. Every function that
 * needs the time takes it as an argument, so the assertions can pin it.
 */

import type { CompositionRule } from "@workspace/db";

/**
 * What sort of finding this is, which decides where it may land.
 *
 * Only `composition` becomes a rule the model reads. The others exist so a
 * conclusion is not silently squeezed into the one landing site that happens to
 * be built: a finding about WHEN to post has no business in an image prompt,
 * and saying so is more useful than quietly dropping it.
 */
export type ConclusionKind =
  | "composition"   // how the work should look. Lands in compositionRules.
  | "schedule"      // when to post. Phase 8 writes brand_schedule_profiles.
  | "channel"       // where to post. Phase 8 writes brand_schedule_profiles.
  | "director"      // which persona performs. Phase 8 ranks designer_personas.
  | "disagreement"; // approved fastest, performed worst. See below.

/** The kinds this file can turn into a brand-record rule. */
const APPLICABLE_HERE: ReadonlySet<ConclusionKind> = new Set<ConclusionKind>(["composition"]);

export interface Evidence {
  /** Published posts the conclusion rests on. */
  n: number;
  /** 0-1, the derivation's own honesty about the finding. */
  confidence: number;
  /** e.g. "the last 90 days". A conclusion has a shelf life and should say so. */
  window: string;
  /** The measured effect in plain words, e.g. "+41% engagement vs average". */
  effect: string;
}

export interface PerformanceConclusion {
  /**
   * Stable across re-derivations of the same finding. This is what lets a
   * retired conclusion stay retired instead of reappearing every week.
   */
  id: string;
  kind: ConclusionKind;
  /** The instruction, written the way it will read in the brand contract. */
  rule: string;
  /** Why we think so, for the human deciding. Never shown to the model. */
  because: string;
  evidence: Evidence;
}

/**
 * The fewest published posts a finding may be offered from.
 *
 * Set deliberately high relative to `confidenceForSample`, which calls three
 * posts "medium". That scale grades a recommendation someone reads once; this
 * one gates a sentence that joins the brand contract and is then sent with
 * every single generation until somebody removes it. With four posts a single
 * outlier is a quarter of the evidence, and the cost of a wrong rule is paid
 * quietly, on every future image, by a person who will not know it is there.
 * The cost of waiting is that a human waits.
 */
export const EVIDENCE_FLOOR = 5;

/** Below this the finding is real but too weak to propose as brand law. */
export const CONFIDENCE_FLOOR = 0.5;

export interface LearnedCandidate {
  conclusionId: string;
  kind: ConclusionKind;
  /** The rule text that would be written. */
  rule: string;
  because: string;
  evidence: Evidence;
  /**
   * The one-line disclosure of the evidence, formatted once here so the screen
   * and the contract cannot drift into quoting different numbers.
   */
  evidenceLine: string;
  /**
   * True when an applied rule already says something about the same thing.
   * Not a block: two rules can coexist. It is here so a human is not asked to
   * accept a contradiction without being shown the incumbent.
   */
  overlapsApplied: string | null;
}

export interface WithheldConclusion {
  conclusionId: string;
  /**
   * What the conclusion actually said, so the disclosure reads as a sentence.
   *
   * The first version showed only the id, and a screen that tells someone
   * "channel:hype:instagram was not proposed" has disclosed a string rather
   * than a finding. Empty when the conclusion had no rule text, which is one of
   * the reasons it could be withheld.
   */
  rule: string;
  reason: string;
}

export interface LearnedProposal {
  candidates: LearnedCandidate[];
  /**
   * Conclusions that were NOT offered, and why, in the same words a person
   * would use. Reported rather than hidden: "we found nothing" and "we found
   * four things and none of them had enough behind them" are different facts,
   * and only one of them means the derivation is working.
   */
  withheld: WithheldConclusion[];
}

/** How the evidence reads wherever it is shown. One formatting, one place. */
export function formatEvidence(e: Evidence): string {
  const pct = Math.round(e.confidence * 100);
  return `${e.n} post${e.n === 1 ? "" : "s"} over ${e.window} · ${e.effect} · ${pct}% confidence`;
}

/**
 * Two rules are about the same thing when they share enough distinctive words.
 *
 * Deliberately crude. The job is not to decide whether a rule is a duplicate —
 * that is the human's call and they are about to make it — but to put the
 * incumbent in front of them when there probably is one. A crude check that
 * over-flags costs a glance; a clever one that under-flags lets two
 * contradictory sentences sit in the contract unnoticed.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "at",
  "is", "are", "be", "it", "that", "this", "than", "then", "as", "by", "from",
  "when", "should", "must", "more", "less", "use", "using", "post", "posts",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w)),
  );
}

export function rulesOverlap(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  // Against the SMALLER set, so a short rule is not drowned by a long one.
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

/** Rules the contract should read: applied, not retired. */
export function activeRules(rules: readonly CompositionRule[]): CompositionRule[] {
  return rules.filter(r => !r.retiredAt);
}

/**
 * Decide which conclusions may be put in front of a human, and why the rest
 * may not.
 */
export function buildLearnedCandidates(
  conclusions: readonly PerformanceConclusion[],
  applied: readonly CompositionRule[] = [],
): LearnedProposal {
  const candidates: LearnedCandidate[] = [];
  const withheld: WithheldConclusion[] = [];
  const seen = new Set<string>();
  // The rule text travels with every refusal so the disclosure reads as a
  // finding rather than as an identifier.
  const withhold = (id: string, c: PerformanceConclusion, reason: string): void => {
    withheld.push({ conclusionId: id, rule: typeof c.rule === "string" ? c.rule.trim() : "", reason });
  };

  // Includes retired rules on purpose. A conclusion someone has already
  // rejected must not come back round every time the job runs; that is the
  // whole reason retiring keeps the row instead of deleting it.
  const decidedIds = new Set(applied.map(r => r.conclusionId).filter(Boolean) as string[]);
  const live = activeRules(applied);

  for (const c of conclusions) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    if (!id) continue;

    if (seen.has(id)) {
      withhold(id, c, "derived more than once in the same run");
      continue;
    }
    seen.add(id);

    if (decidedIds.has(id)) {
      const prior = applied.find(r => r.conclusionId === id)!;
      withhold(id, c, prior.retiredAt ? "you retired this one before" : "already applied");
      continue;
    }

    if (!APPLICABLE_HERE.has(c.kind)) {
      withhold(id, c, `a ${c.kind} finding does not belong in the brand contract, so it is not offered here`);
      continue;
    }

    const rule = typeof c.rule === "string" ? c.rule.trim() : "";
    if (!rule) {
      withhold(id, c, "no rule text");
      continue;
    }

    const e = c.evidence;
    if (!e || typeof e.n !== "number" || !Number.isFinite(e.n)) {
      withhold(id, c, "no sample size, so there is nothing to weigh it by");
      continue;
    }
    if (e.n < EVIDENCE_FLOOR) {
      withhold(id, c, `only ${e.n} post${e.n === 1 ? "" : "s"} behind it, and a brand rule needs at least ${EVIDENCE_FLOOR}`);
      continue;
    }
    if (typeof e.confidence !== "number" || !Number.isFinite(e.confidence) || e.confidence < CONFIDENCE_FLOOR) {
      withhold(id, c, `the effect is not clear enough to act on (${Math.round((Number(e.confidence) || 0) * 100)}% confidence)`);
      continue;
    }

    const incumbent = live.find(r => rulesOverlap(r.rule, rule));
    candidates.push({
      conclusionId: id,
      kind: c.kind,
      rule,
      because: typeof c.because === "string" ? c.because : "",
      evidence: e,
      evidenceLine: formatEvidence(e),
      overlapsApplied: incumbent ? incumbent.rule : null,
    });
  }

  // Strongest evidence first: the one most worth a human's attention is the one
  // resting on the most posts, not the one the job happened to emit first.
  candidates.sort((a, b) => b.evidence.n - a.evidence.n || a.rule.localeCompare(b.rule));
  return { candidates, withheld };
}

/**
 * Accepting a candidate.
 *
 * Appends rather than replaces, because composition rules accumulate: the brand
 * guide's own visual language is not overwritten by something the audience
 * taught us, it is joined by it. `now` is passed in so this stays pure and the
 * assertions can pin the timestamp.
 *
 * **No `fieldProvenance` stamp, and that is a correction.** The first version
 * also wrote `fieldProvenance.compositionRules = "learned"`, on the reasoning
 * that the screen labels fields and §1.17 wants an automated value marked.
 * Walking the screen showed the stamp was never read anywhere, and worse that it
 * could not be right: one field-level word cannot describe an array whose rules
 * came from three different places, so a record with four authored rules and one
 * learned one would have read "Learned" wholesale. **Every rule carries its own
 * `source` and the panel prints it per rule**, which is both visible and true.
 */
export function applyCandidate(
  applied: readonly CompositionRule[],
  candidate: LearnedCandidate,
  now: Date,
): CompositionRule[] {
  const rule: CompositionRule = {
    rule: candidate.rule,
    source: "learned",
    n: candidate.evidence.n,
    confidence: candidate.evidence.confidence,
    appliedAt: now.toISOString(),
    conclusionId: candidate.conclusionId,
  };
  return [...applied, rule];
}

/**
 * Retiring an applied rule.
 *
 * Marks rather than deletes. The row is what keeps the conclusion from being
 * re-offered, and the record should be able to say a rule was tried and
 * rejected. Retiring an already-retired rule is a no-op rather than an error:
 * a double click should not be a failure.
 */
export function retireRule(
  applied: readonly CompositionRule[],
  conclusionId: string,
  now: Date,
): CompositionRule[] | null {
  const idx = applied.findIndex(r => r.conclusionId === conclusionId);
  if (idx < 0) return null;
  return applied.map((r, i) =>
    i === idx && !r.retiredAt ? { ...r, retiredAt: now.toISOString() } : r,
  );
}

/**
 * The composition-rule lines for the brand contract.
 *
 * **The sample size travels with the rule into the prompt, deliberately.** Doc
 * 21 asks for it and §1.17 wants what was sent to be visible, but there is a
 * second reason: this string IS the disclosure the user reads in the Brand
 * contract panel, so a number kept out of it would be a number kept from them.
 * It also does real work on the model, where "learned from 47 posts" reads as a
 * firmer instruction than "learned from 6" — which is exactly the weighting a
 * thin finding deserves.
 *
 * Retired rules are excluded. Returns an empty string rather than a heading
 * with nothing under it.
 */
export function formatCompositionRules(rules: readonly CompositionRule[]): string {
  const live = activeRules(rules);
  if (live.length === 0) return "";
  const lines = live.map(r => {
    const provenance =
      r.source === "learned" ? `learned from ${r.n} post${r.n === 1 ? "" : "s"}`
      : r.source === "guide" ? "from the brand guide"
      : "set by the team";
    return `- ${r.rule} (${provenance})`;
  });
  return `Composition rules for this brand:\n${lines.join("\n")}`;
}

/* ------------------------------------------------------------------------- *
 * One real producer, from the evidence that exists today.
 * ------------------------------------------------------------------------- */

/** The slice of `IntentInsights` this reads. Structural, so it cannot drift. */
export interface IntentInsightLike {
  intent: string | null;
  intentLabel: string | null;
  sampleSize: number;
  platforms: Array<{ platform: string; posts: number; avgEngagement: number }>;
}

/**
 * Turn today's intent insights into conclusions.
 *
 * This is honest about being narrow. `post_metrics` records engagement against
 * a published entry; it knows the intent and the platform and nothing at all
 * about how the image was composed. So the only conclusion available from it
 * today is a **channel** one, and a channel conclusion is correctly withheld
 * from the brand contract by `buildLearnedCandidates` rather than bent into a
 * composition rule it is not.
 *
 * That is the point of running it now rather than waiting for Phase 8. It
 * proves the path end to end, and it proves the refusal: the guard that stops a
 * schedule finding becoming an image instruction is exercised by the very first
 * producer, instead of being a rule nobody has ever run into.
 *
 * Composition conclusions need the link from a published post back to the take
 * that made it — its axis position, its director, its region edits. That link
 * exists in the data and reading it is Phase 8's job.
 */
export function conclusionsFromIntentInsights(
  insights: readonly IntentInsightLike[],
  window = "all tracked posts",
): PerformanceConclusion[] {
  const out: PerformanceConclusion[] = [];

  for (const i of insights) {
    if (!i || i.sampleSize < EVIDENCE_FLOOR) continue;
    const ranked = [...i.platforms].sort((a, b) => b.avgEngagement - a.avgEngagement);
    const best = ranked[0];
    const rest = ranked.slice(1);
    if (!best || best.avgEngagement <= 0 || rest.length === 0) continue;

    const othersAvg = rest.reduce((n, p) => n + p.avgEngagement, 0) / rest.length;
    if (othersAvg <= 0) continue;
    const lift = best.avgEngagement / othersAvg - 1;
    // Under a fifth better is not a finding, it is this quarter's noise.
    if (lift < 0.2) continue;

    const label = i.intentLabel ?? i.intent ?? "these";
    out.push({
      // Stable across re-derivations: same intent, same platform, same finding.
      id: `channel:${i.intent ?? "all"}:${best.platform}`,
      kind: "channel",
      rule: `Lead with ${best.platform} for ${label.toLowerCase()} posts.`,
      because: `${label} posts average ${best.avgEngagement} engagements on ${best.platform} against ${Math.round(othersAvg * 10) / 10} elsewhere.`,
      evidence: {
        n: i.sampleSize,
        confidence: Math.min(0.95, 0.4 + Math.min(i.sampleSize, 20) / 40),
        window,
        effect: `+${Math.round(lift * 100)}% engagement vs other channels`,
      },
    });
  }

  return out;
}
