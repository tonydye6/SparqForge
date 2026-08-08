/**
 * Assertions for trademark-scan. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import {
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  assessAsset,
  formatScanRow,
  summarizeScan,
  formatScanSummary,
  assetIdsToFlag,
  CONFIDENCE_FLOOR,
  type TrademarkFinding,
  type ScanRecord,
} from "./trademark-scan.js";

export interface CaseResult {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const results: CaseResult[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

const f = (over: Partial<TrademarkFinding> = {}): TrademarkFinding => ({
  mark: "Nike swoosh", kind: "sportswear", where: "jersey chest", confidence: 0.92, ...over,
});
const wrap = (findings: unknown[]) => ({ findings });

export async function collectTrademarkScanCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- the prompt names the brand's own marks so they are never reported ----
  {
    const p = buildTrademarkSystemPrompt("Crown U", ["Crown U crown", "SPARQ wordmark"]);
    check("prompt names the brand", p.includes("Crown U"));
    check("prompt lists own marks", p.includes("- Crown U crown") && p.includes("- SPARQ wordmark"));
    check("prompt says empty is correct", /empty array/i.test(p));
    const none = buildTrademarkSystemPrompt("Rumble U", []);
    check("prompt survives no own marks", none.includes("(none recorded)"));
  }

  // ---- the brand's own marks are dropped, however phrased ----
  {
    const { findings, rejected } = parseTrademarkFindings(
      wrap([
        f({ mark: "Crown U crown logo", kind: "other" }),
        f({ mark: "SPARQ wordmark", kind: "other" }),
        f(),
      ]),
      ["Crown U", "SPARQ"],
    );
    check("own marks are not reported", findings.length === 1, findings.map(x => x.mark));
    check("the third-party mark survives", findings[0]?.mark === "Nike swoosh");
    check("own marks are said to be dropped", rejected.filter(r => r.reason === "belongs to this brand").length === 2);
  }

  // ---- low confidence is discarded, and said out loud ----
  {
    const { findings, rejected } = parseTrademarkFindings(
      wrap([f({ confidence: CONFIDENCE_FLOOR - 0.01 }), f({ mark: "Jumpman", confidence: 0.95 })]),
    );
    check("below the floor is dropped", findings.length === 1 && findings[0].mark === "Jumpman");
    check("the drop is reported", rejected.some(r => /below/.test(r.reason)));
  }
  {
    const { findings } = parseTrademarkFindings(wrap([f({ confidence: CONFIDENCE_FLOOR })]));
    check("exactly at the floor is kept", findings.length === 1);
  }

  // ---- malformed input is refused rather than coerced ----
  {
    const { findings, rejected } = parseTrademarkFindings(
      wrap([
        f({ kind: "sponsor" as never }),
        f({ mark: "Adidas", confidence: "high" as never }),
        { nonsense: true },
        f({ mark: "   " }),
      ]),
    );
    check("no malformed finding survives", findings.length === 0, findings);
    check("bad kind is named", rejected.some(r => /unknown kind/.test(r.reason)));
    check("non-numeric confidence is named", rejected.some(r => /numeric confidence/.test(r.reason)));
  }
  {
    for (const bad of [null, undefined, 42, "findings", {}, { findings: "no" }]) {
      const { findings } = parseTrademarkFindings(bad);
      check(`garbage input ${JSON.stringify(bad)} yields nothing`, findings.length === 0);
    }
  }

  // ---- findings come back most-certain first ----
  {
    const { findings } = parseTrademarkFindings(
      wrap([f({ mark: "B1G", kind: "conference", confidence: 0.7 }), f({ confidence: 0.99 })]),
    );
    check("sorted by confidence", findings[0].mark === "Nike swoosh", findings.map(x => x.mark));
  }

  // ---- severity ----
  {
    const clear = assessAsset([]);
    check("nothing found is clear", clear.severity === "clear" && !clear.recommendBlock);

    const blocked = assessAsset([f()]);
    check("sportswear blocks", blocked.severity === "blocked" && blocked.recommendBlock);
    check("blocked reason names the mark and place", /Nike swoosh \(jersey chest\)/.test(blocked.reason));
    check("blocked reason explains inheritance", /inherits/.test(blocked.reason));

    for (const kind of ["league", "broadcaster"] as const) {
      check(`${kind} blocks`, assessAsset([f({ kind })]).severity === "blocked");
    }
    for (const kind of ["conference", "university"] as const) {
      const a = assessAsset([f({ kind })]);
      check(`${kind} is review, not block`, a.severity === "review" && !a.recommendBlock);
      check(`${kind} defers to a human`, /human/.test(a.reason));
    }

    // One blocking mark among institutional ones still blocks.
    const mixed = assessAsset([f({ mark: "B1G", kind: "conference", where: "collar" }), f()]);
    check("any blocking mark wins", mixed.severity === "blocked");
    check("blocked list still carries every finding", mixed.findings.length === 2);
    // The reason must not omit the non-blocking marks. A compliance report that
    // mentions the swoosh and not the shield reads as an all-clear on the shield.
    check("blocked reason names the blocking mark", /Nike swoosh \(jersey chest\)/.test(mixed.reason));
    check("blocked reason ALSO names the institutional mark", /B1G \(collar\)/.test(mixed.reason), mixed.reason);
    check("blocked reason separates the two questions", /separate question/.test(mixed.reason));
    // With nothing else present, no dangling "also" clause.
    check("no also-clause when there is nothing else", !/Also present/.test(assessAsset([f()]).reason));
  }

  // ---- licensed kinds stop driving severity but are still reported ----
  {
    const opts = { licensedKinds: ["conference", "university"] as const };
    const onlyLicensed = assessAsset([f({ mark: "B1G", kind: "conference", where: "collar" })], opts);
    check("licensed-only is clear", onlyLicensed.severity === "clear" && !onlyLicensed.recommendBlock);
    check("clear STILL lists what was seen", /B1G \(collar\)/.test(onlyLicensed.reason), onlyLicensed.reason);
    check("clear says they were licensed", /licensed/.test(onlyLicensed.reason));
    check("findings are not discarded", onlyLicensed.findings.length === 1);

    // A swoosh alongside licensed collegiate marks still blocks, and the
    // licensed ones are still named.
    const mixed2 = assessAsset([f({ mark: "B1G", kind: "conference", where: "collar" }), f()], opts);
    check("a swoosh among licensed marks still blocks", mixed2.severity === "blocked");
    check("blocked names the swoosh", /Nike swoosh/.test(mixed2.reason));
    check("blocked still names the licensed mark", /B1G \(collar\)/.test(mixed2.reason), mixed2.reason);

    // Without the option, the same input is review — the default is unchanged.
    check("default still treats conference as review",
      assessAsset([f({ mark: "B1G", kind: "conference" })]).severity === "review");
  }

  // ---- the report row ----
  {
    const row = formatScanRow("crownu_char_female.jpeg", assessAsset([f()]));
    check("row flags BLOCKED", row.includes("BLOCKED"));
    check("row shows mark, place and confidence", /Nike swoosh@jersey chest 92%/.test(row));
    const clean = formatScanRow("logo.png", assessAsset([]));
    check("clear row has no marks appended", clean.trimEnd().endsWith("logo.png"));
    const long = formatScanRow("x".repeat(90), assessAsset([]));
    check("long names are truncated, not wrapped", !long.includes("\n") && long.length < 120);
  }

  // ---- the ledger: every record leaves with exactly one outcome ----
  {
    const rec = (over: Partial<ScanRecord>): ScanRecord => ({
      assetId: "a1", name: "one.jpeg", contentKey: "k1", outcome: "clear",
      assessment: assessAsset([]), ...over,
    });
    const blocked = assessAsset([f()]);

    // Reconciliation is the whole point: 268 targets once produced 267 lines.
    {
      const s = summarizeScan([rec({}), rec({ assetId: "a2" })], 2);
      check("a complete scan reconciles", s.reconciled && s.unaccounted === 0);
      check("complete scan says so", /Every record accounted for/.test(formatScanSummary(s)));
    }
    {
      const s = summarizeScan([rec({})], 2);
      check("a short scan does not reconcile", !s.reconciled && s.unaccounted === 1);
      const out = formatScanSummary(s);
      check("a short scan says it is incomplete", /incomplete/.test(out), out);
      check("a short scan names the missing count", /1 record left this scan with NO verdict/.test(out), out);
    }
    {
      // An errored record is counted, not dropped. That was the defect.
      const s = summarizeScan(
        [rec({}), rec({ assetId: "a2", outcome: "error", assessment: null, errorMessage: "503" })],
        2,
      );
      check("an error still accounts for its record", s.reconciled, s.counts);
      check("errors are counted separately", s.counts.error === 1);
      const out = formatScanSummary(s);
      check("the summary shouts about errors", /ERRORED\s+1/.test(out), out);
      check("the summary says an errored report is not trustworthy", /rerun/i.test(out));
    }
    {
      const s = summarizeScan([rec({ outcome: "unreadable", contentKey: null, assessment: null })], 1);
      check("unreadable accounts for its record", s.reconciled && s.counts.unreadable === 1);
      check("unreadable is not counted as scanned", s.uniqueImagesScanned === 0);
    }

    // ---- duplicates: one model call, every record still flagged ----
    {
      const s = summarizeScan([
        rec({ assetId: "a1", name: "track_default.jpeg", contentKey: "kA", outcome: "blocked", assessment: blocked }),
        rec({ assetId: "a2", name: "track_unknown.jpeg", contentKey: "kA", outcome: "duplicate", assessment: blocked, duplicateOf: "track_default.jpeg" }),
        rec({ assetId: "a3", name: "clean.png", contentKey: "kB", outcome: "clear", assessment: assessAsset([]) }),
      ], 3);

      check("duplicates reconcile", s.reconciled);
      check("a duplicate is not a second model call", s.uniqueImagesScanned === 2, s.uniqueImagesScanned);
      check("redundant records are counted", s.redundantRecords === 1);
      check("the shortlist has one entry per IMAGE", s.blockedGroups.length === 1, s.blockedGroups.length);
      check("the group carries both records", s.blockedGroups[0]?.assetIds.length === 2, s.blockedGroups[0]?.assetIds);
      check("the group names both filings", s.blockedGroups[0]?.names.join(",") === "track_default.jpeg,track_unknown.jpeg", s.blockedGroups[0]?.names);

      // The write must reach the twin. generationAllowed lives on the record,
      // so blocking one row and not the other leaves the image usable.
      const ids = assetIdsToFlag(s);
      check("flagging writes to every record in the group", ids.length === 2 && ids.includes("a1") && ids.includes("a2"), ids);
      check("flagging leaves clear assets alone", !ids.includes("a3"));

      const out = formatScanSummary(s);
      check("the summary separates records from images", /3 records · 2 unique images scanned · 1 distinct image to decide about/.test(out), out);
    }
    {
      // Same bytes filed under one name twice: still one image, still two gates.
      const s = summarizeScan([
        rec({ assetId: "a1", name: "same.jpeg", contentKey: "kA", outcome: "blocked", assessment: blocked }),
        rec({ assetId: "a2", name: "same.jpeg", contentKey: "kA", outcome: "duplicate", assessment: blocked }),
      ], 2);
      check("one name filed twice is one group", s.blockedGroups.length === 1);
      check("a repeated name is not listed twice", s.blockedGroups[0]?.names.length === 1, s.blockedGroups[0]?.names);
      check("both records are still flagged", assetIdsToFlag(s).length === 2);
    }
    {
      // Review and clear never reach the shortlist, however many findings.
      const s = summarizeScan([
        rec({ assetId: "a1", contentKey: "kA", outcome: "review", assessment: assessAsset([f({ kind: "conference" })]) }),
        rec({ assetId: "a2", contentKey: "kB", outcome: "clear", assessment: assessAsset([f({ kind: "conference" })], { licensedKinds: ["conference"] }) }),
      ], 2);
      check("review is not on the block shortlist", s.blockedGroups.length === 0);
      check("nothing is flagged from review or clear", assetIdsToFlag(s).length === 0);
      check("review still reconciles", s.reconciled && s.counts.review === 1 && s.counts.clear === 1);
    }
    {
      const s = summarizeScan([], 0);
      check("an empty scan reconciles", s.reconciled && s.blockedGroups.length === 0);
      check("an empty scan reads sensibly", /0 records · 0 unique images/.test(formatScanSummary(s)));
    }
  }

  return results;
}
