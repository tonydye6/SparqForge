/**
 * Assertions for identity-check. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import {
  buildIdentitySystemPrompt,
  buildIdentityUserPrompt,
  parseIdentityVerdict,
  formatIdentityRow,
  IDENTITY_CONFIDENCE_FLOOR,
} from "./identity-check.js";
import type { TrademarkFinding } from "./trademark-scan.js";

export interface CaseResult { name: string; ok: boolean; detail?: unknown }
const results: CaseResult[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

const good = (over: Record<string, unknown> = {}) => ({
  sameSubject: true, subjectConfidence: 0.95, subjectNotes: "Same face, beard and build.",
  marksRemoved: true, remainingMarks: [], unintendedChanges: [], ...over,
});
const f = (over: Partial<TrademarkFinding> = {}): TrademarkFinding => ({
  mark: "Nike swoosh", kind: "sportswear", where: "left shoe", confidence: 0.9, ...over,
});

export async function collectIdentityCheckCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- the prompt keeps the two questions apart ----
  {
    const p = buildIdentitySystemPrompt();
    check("both questions are asked", /sameSubject/.test(p) && /marksRemoved/.test(p));
    check("framing is explicitly NOT identity", /Do NOT judge on framing/.test(p));
    check("re-framing is called out as still the same character", /re-framed/.test(p));
    check("a different face is called out as not", /different face/.test(p));
    check("uncertainty is invited rather than punished", /unsure/.test(p));
    check("the asymmetry is stated", /more expensive/.test(p));
    const u = buildIdentityUserPrompt("char.png", [f(), f({ mark: "Jumpman", where: "shoulder" })]);
    check("the marks to look for are listed", /Nike swoosh \(was at: left shoe\)/.test(u) && /Jumpman/.test(u));
    check("the image order is stated", /first image is the ORIGINAL/.test(u));
    check("no marks is handled", /none recorded/.test(buildIdentityUserPrompt("x.png", [])));
  }

  // ---- accepting ----
  {
    const v = parseIdentityVerdict(good());
    check("a clean pass is accepted", v.accept);
    check("and still says what it looked at", /Same face, beard and build/.test(v.reason), v.reason);
    check("the confidence is quoted", /95% sure/.test(v.reason));
  }

  // ---- every way it must refuse ----
  {
    const diff = parseIdentityVerdict(good({ sameSubject: false, subjectNotes: "Different face and hair." }));
    check("a different character is refused", !diff.accept);
    check("and the note is carried into the reason", /Different face and hair/.test(diff.reason), diff.reason);

    const unsure = parseIdentityVerdict(good({ subjectConfidence: IDENTITY_CONFIDENCE_FLOOR - 0.01 }));
    check("an unsure yes is refused", !unsure.accept);
    check("and names the floor", /80% is the floor/.test(unsure.reason), unsure.reason);
    check("exactly at the floor is accepted", parseIdentityVerdict(good({ subjectConfidence: IDENTITY_CONFIDENCE_FLOOR })).accept);

    const left = parseIdentityVerdict(good({ marksRemoved: false }));
    check("marks not removed is refused", !left.accept);

    // The one that matters: ticking the box AND listing a visible mark.
    const contradiction = parseIdentityVerdict(good({ marksRemoved: true, remainingMarks: ["Nike swoosh on the right shoe"] }));
    check("a listed mark overrides the tick", !contradiction.accept, contradiction);
    check("and the reason names it", /still visible: Nike swoosh on the right shoe/.test(contradiction.reason));

    const other = parseIdentityVerdict(good({ unintendedChanges: ["the jersey number changed from 2 to 3"] }));
    check("an unintended change is refused", !other.accept);
    check("and is named", /jersey number changed/.test(other.reason));
  }

  // ---- fails closed ----
  {
    for (const bad of [null, undefined, 42, "yes", {}, [], { sameSubject: "true" }]) {
      const v = parseIdentityVerdict(bad);
      check(`garbage ${JSON.stringify(bad)} is refused, not passed`, !v.accept);
      check(`garbage ${JSON.stringify(bad)} scores zero confidence`, v.subjectConfidence === 0);
    }
    const missing = parseIdentityVerdict({ sameSubject: true, marksRemoved: true });
    check("missing confidence is refused rather than assumed", !missing.accept);
    check("a NaN confidence is refused", !parseIdentityVerdict(good({ subjectConfidence: NaN })).accept);
    check("confidence is clamped", parseIdentityVerdict(good({ subjectConfidence: 5 })).subjectConfidence === 1);
  }

  // ---- the report row ----
  {
    const row = formatIdentityRow("crownu_char_male.png", parseIdentityVerdict(good()));
    check("an accepted row says ACCEPT", /ACCEPT/.test(row));
    check("and shows both answers", /same=y@95%/.test(row) && /marks=gone/.test(row), row);
    const bad = formatIdentityRow("x.png", parseIdentityVerdict(good({ sameSubject: false, unintendedChanges: ["pose"] })));
    check("a refused row says REFUSE", /REFUSE/.test(bad));
    check("and flags the other changes", /other=1/.test(bad), bad);
    check("rows stay one line", !row.includes("\n"));
  }

  return results;
}
