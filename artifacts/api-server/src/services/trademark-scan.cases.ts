/**
 * Assertions for trademark-scan. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import {
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  assessAsset,
  formatScanRow,
  CONFIDENCE_FLOOR,
  type TrademarkFinding,
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
    const mixed = assessAsset([f({ mark: "B1G", kind: "conference" }), f()]);
    check("any blocking mark wins", mixed.severity === "blocked");
    check("blocked list still carries every finding", mixed.findings.length === 2);
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

  return results;
}
