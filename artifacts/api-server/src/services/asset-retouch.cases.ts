/**
 * Assertions for asset-retouch. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import {
  buildRetouchPlan,
  formatRetouchPlan,
  retouchVerdict,
  retouchMessage,
  isSafeToApply,
  CHANGE_CEILING,
  CHANGE_FLOOR,
} from "./asset-retouch.js";
import type { TrademarkFinding } from "./trademark-scan.js";

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
  mark: "Nike swoosh", kind: "sportswear", where: "left thigh of the shorts", confidence: 0.92, ...over,
});

export async function collectAssetRetouchCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- the instruction ----
  {
    const plan = buildRetouchPlan([f()])!;
    check("a finding yields a plan", plan !== null && plan.removing.length === 1);

    const i = plan.instruction;
    // Position is the thing this project has paid to learn twice.
    check("the scope clause LEADS", i.startsWith("Change ONLY the small areas listed below."), i.slice(0, 60));
    check("the mark is named", /Remove the Nike swoosh/.test(i));
    check("the location scopes it", /from the left thigh of the shorts/.test(i));
    check("it says what to put back", /matching that surface's exact colour, shading, texture and lighting/.test(i));
    // A four-angle turnaround carries the same swoosh several times.
    check("every occurrence, not just the first", /EVERY occurrence/.test(i));
    check("including other views of the same subject", /other view, angle or repeat/.test(i));
    check("the preservation clause closes", /indistinguishable from the original everywhere except where a mark was\.$/.test(i.trim()));
    check("identity is protected explicitly", /Do not change the face, hair, build, pose/.test(i));
    check("framing is protected too", /background, framing, crop or aspect ratio/.test(i));
    check("nothing may be added", /Do not add anything/.test(i));

    // The identity-loss bug was prose re-describing a subject whose picture was
    // attached. A retouch must never describe the subject.
    check("the subject is never described", !/dark-skinned|curly|athlete with|wearing a/i.test(i), i);
  }
  {
    const plan = buildRetouchPlan([f(), f({ mark: "Jordan Jumpman", where: "left shoulder of the jersey" })])!;
    check("two marks make ONE instruction", plan.instruction.split("- Remove the").length === 3, plan.instruction);
    check("both marks are named", /Nike swoosh/.test(plan.instruction) && /Jordan Jumpman/.test(plan.instruction));
    check("both are recorded as being removed", plan.removing.length === 2);
  }

  // ---- what is deliberately left alone ----
  {
    const plan = buildRetouchPlan(
      [f(), f({ mark: "B1G shield", kind: "conference", where: "collar" })],
      { keepKinds: ["conference", "university"] },
    )!;
    check("a licensed mark is not removed", plan.removing.length === 1 && plan.removing[0].mark === "Nike swoosh");
    check("and the omission is reported, not silent", plan.skipped.length === 1, plan.skipped);
    check("with a reason naming the licence", /licensed for this brand/.test(plan.skipped[0].reason));
    check("the instruction does not mention it", !/B1G/.test(plan.instruction));
  }
  {
    // No location means no scope, and an unscoped removal repaints the subject.
    const plan = buildRetouchPlan([f({ where: "unstated" }), f({ mark: "Adidas stripes", where: "both shoes" })])!;
    check("a mark with no location is skipped", plan.removing.length === 1 && plan.removing[0].mark === "Adidas stripes");
    check("and says why", /could not say where it is/.test(plan.skipped[0].reason));
    check("the reason names the risk", /repaint the subject/.test(plan.skipped[0].reason));
    for (const bad of ["", "   ", "UNSTATED"]) {
      const p = buildRetouchPlan([f({ where: bad })]);
      check(`where=${JSON.stringify(bad)} yields no plan at all`, p === null);
    }
  }
  {
    check("no findings means no plan", buildRetouchPlan([]) === null);
    check("only licensed findings means no plan",
      buildRetouchPlan([f({ kind: "university", where: "chest" })], { keepKinds: ["university"] }) === null);
  }

  // ---- the verdict ----
  {
    check("nothing changed is caught", retouchVerdict(0) === "unchanged");
    check("just under the floor is still nothing", retouchVerdict(CHANGE_FLOOR - 0.001) === "unchanged");
    check("a spot removal is clean", retouchVerdict(1.2) === "clean");
    // The live 2026-08-07 removal: two swooshes gone, identity plainly held.
    check("the live spot removal is not called a repaint", retouchVerdict(14.9) !== "repainted", retouchVerdict(14.9));
    check("half the ceiling is still clean", retouchVerdict(CHANGE_CEILING / 2) === "clean");
    check("above half is notable", retouchVerdict(CHANGE_CEILING / 2 + 0.1) === "notable");
    check("at the ceiling is still notable", retouchVerdict(CHANGE_CEILING) === "notable");
    check("over the ceiling is a repaint", retouchVerdict(CHANGE_CEILING + 0.1) === "repainted");
    // The number the region-edit walkthrough actually produced.
    check("27.5% reads as a repaint", retouchVerdict(27.5) === "repainted");
    check("a full repaint is caught", retouchVerdict(60) === "repainted");
  }
  {
    check("only a clean result may be applied unattended", isSafeToApply(1) && !isSafeToApply(CHANGE_CEILING) && !isSafeToApply(0));
  }
  {
    // Never says "done", always says what to check.
    check("unchanged tells you not to keep it", /Do not keep this/.test(retouchMessage(0)));
    check("unchanged says the mark is probably still there", /still there/.test(retouchMessage(0)));
    check("clean still asks you to look", /Check the mark is gone/.test(retouchMessage(1)));
    check("notable names what to compare", /Compare the face and the pose/.test(retouchMessage(CHANGE_CEILING * 0.75)));
    check("repainted says discard", /Discard it/.test(retouchMessage(30)));
    check("repainted names the real cost", /identity will not have survived/.test(retouchMessage(30)));
    for (const pct of [0, 0.04, 1, 4, 14.9, 27.5, 100]) {
      check(`the message quotes the number at ${pct}`, retouchMessage(pct).includes(pct.toFixed(1)));
    }
  }

  // ---- the report line ----
  {
    const plan = buildRetouchPlan([f(), f({ mark: "B1G", kind: "conference", where: "collar" })], { keepKinds: ["conference"] })!;
    const line = formatRetouchPlan("crownu_char_male_sparq_football_default.jpeg", plan);
    check("the line names what is being removed", /removing: Nike swoosh@left thigh of the shorts/.test(line), line);
    check("and what is being left", /leaving: B1G/.test(line), line);
    check("it stays one line", !line.includes("\n"));
    const clean = formatRetouchPlan("x.png", buildRetouchPlan([f()])!);
    check("no leaving-clause when nothing was skipped", !/leaving/.test(clean));
  }

  return results;
}
