/**
 * Assertions for performance-learning. Shared by the vitest suite and the tsx
 * verify reporter, so both run exactly the same checks.
 */
import type { CompositionRule } from "@workspace/db";
import {
  buildLearnedCandidates,
  applyCandidate,
  retireRule,
  formatCompositionRules,
  formatEvidence,
  activeRules,
  rulesOverlap,
  conclusionsFromIntentInsights,
  EVIDENCE_FLOOR,
  CONFIDENCE_FLOOR,
  type PerformanceConclusion,
  type Evidence,
  type IntentInsightLike,
} from "./performance-learning.js";

export interface CaseResult {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const results: CaseResult[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

const NOW = new Date("2026-08-07T12:00:00.000Z");

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  n: 12, confidence: 0.8, window: "the last 90 days", effect: "+41% engagement vs average", ...over,
});

const conc = (over: Partial<PerformanceConclusion> = {}): PerformanceConclusion => ({
  id: "c1",
  kind: "composition",
  rule: "Let the subject cross the keyline frame edge.",
  because: "Frame-breaking takes outperformed contained ones.",
  evidence: ev(),
  ...over,
});

const applied = (over: Partial<CompositionRule> = {}): CompositionRule => ({
  rule: "Keep gold to trim and rim light.",
  source: "learned", n: 20, confidence: 0.9, appliedAt: "2026-07-01T00:00:00.000Z",
  conclusionId: "old1", ...over,
});

export async function collectPerformanceLearningCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- the evidence floor is the analogue of the guide's quote rule ----
  {
    const { candidates, withheld } = buildLearnedCandidates([conc({ evidence: ev({ n: EVIDENCE_FLOOR - 1 }) })]);
    check("a thin finding is not offered", candidates.length === 0);
    check("and the floor is named in the reason", /at least 5/.test(withheld[0]?.reason ?? ""), withheld);
    check("the withheld reason states the actual count", /only 4 posts/.test(withheld[0]?.reason ?? ""));
  }
  {
    const { candidates } = buildLearnedCandidates([conc({ evidence: ev({ n: EVIDENCE_FLOOR }) })]);
    check("exactly at the floor is offered", candidates.length === 1);
  }
  {
    const { candidates, withheld } = buildLearnedCandidates([conc({ evidence: ev({ confidence: CONFIDENCE_FLOOR - 0.01 }) })]);
    check("a weak effect is not offered", candidates.length === 0);
    check("the weak-effect reason is in plain words", /not clear enough to act on/.test(withheld[0]?.reason ?? ""));
  }
  {
    const missing = buildLearnedCandidates([conc({ evidence: { ...ev(), n: undefined as never } })]);
    check("no sample size is refused, not defaulted", missing.candidates.length === 0);
    check("and says why", /nothing to weigh it by/.test(missing.withheld[0]?.reason ?? ""));
  }

  // ---- a finding that does not belong here is REFUSED, not bent to fit ----
  {
    for (const kind of ["schedule", "channel", "director", "disagreement"] as const) {
      const { candidates, withheld } = buildLearnedCandidates([conc({ kind })]);
      check(`a ${kind} finding never becomes a composition rule`, candidates.length === 0);
      check(`and the refusal names the kind`, withheld[0]?.reason.includes(kind) === true, withheld[0]);
    }
    const ok = buildLearnedCandidates([conc({ kind: "composition" })]);
    check("a composition finding is offered", ok.candidates.length === 1);
  }

  // ---- withheld is reported, because "none" and "none survived" differ ----
  {
    const { candidates, withheld } = buildLearnedCandidates([
      conc({ id: "a", evidence: ev({ n: 2 }) }),
      conc({ id: "b", kind: "schedule" }),
    ]);
    check("nothing survives this run", candidates.length === 0);
    check("but both refusals are reported", withheld.length === 2, withheld);
    const empty = buildLearnedCandidates([]);
    check("no conclusions at all yields no withheld rows either", empty.withheld.length === 0 && empty.candidates.length === 0);
  }
  {
    /*
     * A refusal carries the rule text, not just the id. Walking the screen
     * showed the first version telling a person "channel:hype:instagram was not
     * proposed", which discloses a string rather than a finding.
     */
    const { withheld } = buildLearnedCandidates([conc({ id: "channel:hype:instagram", kind: "channel" })]);
    check("a refusal says what the finding was", withheld[0]?.rule === "Let the subject cross the keyline frame edge.", withheld[0]);
    check("and still carries the id for dedupe", withheld[0]?.conclusionId === "channel:hype:instagram");
    const noText = buildLearnedCandidates([conc({ rule: "  " })]);
    check("a refusal with no rule text says so with an empty string", noText.withheld[0]?.rule === "");
  }

  // ---- a decision already made is not put back in front of the user ----
  {
    const already = buildLearnedCandidates([conc({ id: "c1" })], [applied({ conclusionId: "c1" })]);
    check("an applied conclusion is not re-offered", already.candidates.length === 0);
    check("and says it is already applied", already.withheld[0]?.reason === "already applied");

    // The one that matters: a retired rule keeps its row precisely so this works.
    const retired = buildLearnedCandidates(
      [conc({ id: "c1" })],
      [applied({ conclusionId: "c1", retiredAt: "2026-07-15T00:00:00.000Z" })],
    );
    check("a RETIRED conclusion stays retired", retired.candidates.length === 0, retired.candidates);
    check("and the reason says the human decided it", /you retired this one before/.test(retired.withheld[0]?.reason ?? ""));
  }
  {
    const twice = buildLearnedCandidates([conc({ id: "dup" }), conc({ id: "dup" })]);
    check("the same conclusion twice in one run is offered once", twice.candidates.length === 1);
    check("and the repeat is reported", /more than once/.test(twice.withheld[0]?.reason ?? ""));
  }

  // ---- the incumbent is shown rather than silently contradicted ----
  {
    const incumbent = applied({ rule: "Keep gold restrained to trim and rim lighting.", conclusionId: "g1" });
    const { candidates } = buildLearnedCandidates(
      [conc({ id: "c2", rule: "Keep gold to trim and rim light only." })],
      [incumbent],
    );
    check("an overlapping rule is still offered", candidates.length === 1);
    check("with the incumbent named", candidates[0]?.overlapsApplied === incumbent.rule, candidates[0]?.overlapsApplied);

    const unrelated = buildLearnedCandidates([conc({ id: "c3" })], [incumbent]);
    check("an unrelated rule flags no incumbent", unrelated.candidates[0]?.overlapsApplied === null);

    // A RETIRED rule is not an incumbent: it is not in the contract.
    const retiredIncumbent = buildLearnedCandidates(
      [conc({ id: "c4", rule: "Keep gold to trim and rim light only." })],
      [applied({ rule: "Keep gold restrained to trim and rim lighting.", conclusionId: "g2", retiredAt: "2026-07-15T00:00:00.000Z" })],
    );
    check("a retired rule is not shown as the incumbent", retiredIncumbent.candidates[0]?.overlapsApplied === null);
  }
  {
    check("overlap needs shared substance", rulesOverlap("Let the subject cross the frame edge.", "The subject should cross the frame edge."));
    check("overlap is not triggered by filler alone", !rulesOverlap("Use more of the thing.", "Use less of that."));
    check("overlap survives a length difference",
      rulesOverlap("Gold trim only.", "Keep the gold restricted to trim and never a full-surface field."));
    check("empty text overlaps nothing", !rulesOverlap("", "anything at all here"));
  }

  // ---- strongest evidence first ----
  {
    const { candidates } = buildLearnedCandidates([
      conc({ id: "small", rule: "Small.", evidence: ev({ n: 6 }) }),
      conc({ id: "big", rule: "Big.", evidence: ev({ n: 60 }) }),
    ]);
    check("the best-evidenced candidate leads", candidates[0]?.conclusionId === "big", candidates.map(c => c.conclusionId));
  }

  // ---- accepting ----
  {
    const c = buildLearnedCandidates([conc()]).candidates[0]!;
    const next = applyCandidate([], c, NOW);
    check("accepting appends one rule", next.length === 1);
    const r = next[0]!;
    check("the rule is stamped learned", r.source === "learned");
    check("the sample size travels onto the rule", r.n === 12);
    check("the conclusion id travels onto the rule", r.conclusionId === "c1");
    check("appliedAt is the time it was passed", r.appliedAt === NOW.toISOString());
    check("nothing is retired on the way in", r.retiredAt === undefined);

    // Appends, never replaces: the guide's language is joined, not overwritten.
    const existing = [applied({ rule: "From the guide.", source: "guide", conclusionId: undefined })];
    const second = applyCandidate(existing, c, NOW);
    check("an existing rule survives", second.length === 2);
    check("the existing rule is unchanged", second[0]?.rule === "From the guide.");
    check("rules from different sources coexist",
      second.map(x => x.source).join(",") === "guide,learned", second.map(x => x.source));
  }

  // ---- retiring ----
  {
    const rules = [applied({ conclusionId: "keep" }), applied({ rule: "Second.", conclusionId: "drop" })];
    const out = retireRule(rules, "drop", NOW)!;
    check("the retired rule is MARKED, not deleted", out.length === 2);
    check("with the time it was retired", out[1]?.retiredAt === NOW.toISOString());
    check("the other rule is untouched", out[0]?.retiredAt === undefined);

    check("retiring something absent returns null rather than pretending", retireRule(rules, "nope", NOW) === null);

    // A double click must not rewrite the original retirement date.
    const twice = retireRule(out, "drop", new Date("2026-09-09T00:00:00.000Z"))!;
    check("retiring twice keeps the first date", twice[1]?.retiredAt === NOW.toISOString());
  }

  // ---- the contract lines ----
  {
    check("no rules means no heading", formatCompositionRules([]) === "");
    check("only-retired rules mean no heading",
      formatCompositionRules([applied({ retiredAt: "2026-07-15T00:00:00.000Z" })]) === "");

    const text = formatCompositionRules([
      applied({ rule: "Learned one.", source: "learned", n: 47 }),
      applied({ rule: "Guide one.", source: "guide", conclusionId: undefined }),
      applied({ rule: "Typed one.", source: "user", conclusionId: undefined }),
      applied({ rule: "Retired one.", retiredAt: "2026-07-15T00:00:00.000Z" }),
    ]);
    check("the contract carries the live rules", /Learned one\./.test(text) && /Guide one\./.test(text) && /Typed one\./.test(text));
    check("and excludes the retired one", !/Retired one/.test(text), text);
    check("a learned rule carries its sample size into the prompt", /Learned one\. \(learned from 47 posts\)/.test(text), text);
    check("a guide rule says so instead of quoting an n", /Guide one\. \(from the brand guide\)/.test(text), text);
    check("a typed rule says the team set it", /Typed one\. \(set by the team\)/.test(text), text);
    check("one post is not pluralised",
      /learned from 1 post\)/.test(formatCompositionRules([applied({ n: 1 })])));
  }
  {
    const all = [applied({ conclusionId: "a" }), applied({ conclusionId: "b", retiredAt: "x" })];
    check("activeRules drops the retired", activeRules(all).length === 1 && activeRules(all)[0]?.conclusionId === "a");
  }

  // ---- the evidence line is formatted once ----
  {
    const line = formatEvidence(ev({ n: 1 }));
    check("evidence reads as a sentence", /1 post over the last 90 days · \+41% engagement vs average · 80% confidence/.test(line), line);
    check("plural posts", /^12 posts /.test(formatEvidence(ev())));
    const c = buildLearnedCandidates([conc()]).candidates[0]!;
    check("the candidate quotes the same line", c.evidenceLine === formatEvidence(ev()));
  }

  // ---- the real producer, and the refusal it exercises ----
  {
    const insights: IntentInsightLike[] = [{
      intent: "hype", intentLabel: "Hype", sampleSize: 14,
      platforms: [
        { platform: "instagram", posts: 8, avgEngagement: 120 },
        { platform: "x", posts: 6, avgEngagement: 40 },
      ],
    }];
    const derived = conclusionsFromIntentInsights(insights);
    check("a real channel conclusion is derived", derived.length === 1, derived);
    check("it is a channel finding, honestly labelled", derived[0]?.kind === "channel");
    check("its id is stable across re-derivation", derived[0]?.id === "channel:hype:instagram");
    check("the effect is quantified", /\+200% engagement/.test(derived[0]?.evidence.effect ?? ""), derived[0]?.evidence);

    // The point of running it: the guard refuses it rather than bending it.
    const proposal = buildLearnedCandidates(derived);
    check("and it is REFUSED as a composition rule", proposal.candidates.length === 0);
    check("with the reason naming channel", /channel finding does not belong/.test(proposal.withheld[0]?.reason ?? ""));
  }
  {
    const thin: IntentInsightLike[] = [{
      intent: "hype", intentLabel: "Hype", sampleSize: EVIDENCE_FLOOR - 1,
      platforms: [{ platform: "instagram", posts: 4, avgEngagement: 120 }, { platform: "x", posts: 0, avgEngagement: 10 }],
    }];
    check("too few posts derives nothing at all", conclusionsFromIntentInsights(thin).length === 0);
  }
  {
    const flat: IntentInsightLike[] = [{
      intent: "hype", intentLabel: "Hype", sampleSize: 20,
      platforms: [{ platform: "instagram", posts: 10, avgEngagement: 100 }, { platform: "x", posts: 10, avgEngagement: 95 }],
    }];
    check("a 5% difference is noise, not a finding", conclusionsFromIntentInsights(flat).length === 0);
  }
  {
    const single: IntentInsightLike[] = [{
      intent: null, intentLabel: null, sampleSize: 20,
      platforms: [{ platform: "instagram", posts: 20, avgEngagement: 100 }],
    }];
    check("one platform cannot outperform the others", conclusionsFromIntentInsights(single).length === 0);
    const none: IntentInsightLike[] = [{ intent: null, intentLabel: null, sampleSize: 20, platforms: [] }];
    check("no platforms derives nothing", conclusionsFromIntentInsights(none).length === 0);
  }
  {
    // The state dev is actually in. It must be silence, not a crash.
    check("an empty dataset derives nothing", conclusionsFromIntentInsights([]).length === 0);
    const p = buildLearnedCandidates(conclusionsFromIntentInsights([]));
    check("and proposes nothing, quietly", p.candidates.length === 0 && p.withheld.length === 0);
  }

  // ---- garbage in ----
  {
    for (const bad of [null, undefined, 42, "conclusion", {}] as unknown[]) {
      const p = buildLearnedCandidates([bad as PerformanceConclusion]);
      check(`garbage conclusion ${JSON.stringify(bad)} yields nothing`, p.candidates.length === 0);
    }
    const noId = buildLearnedCandidates([conc({ id: "  " })]);
    check("a conclusion with no id is dropped", noId.candidates.length === 0);
    const noRule = buildLearnedCandidates([conc({ rule: "   " })]);
    check("a conclusion with no rule text is dropped", noRule.candidates.length === 0);
    check("and says so", /no rule text/.test(noRule.withheld[0]?.reason ?? ""));
  }

  return results;
}
