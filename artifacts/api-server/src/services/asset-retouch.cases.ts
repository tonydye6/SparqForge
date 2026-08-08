/**
 * Assertions for asset-retouch. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import {
  estimateBackground,
  subjectMask,
  erodeMask,
  intersectMasks,
  backgroundChanged,
  BACKGROUND_TOLERANCE,
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

  // ---- the measurement, and the mistake it replaces ----
  {
    /** A w x h RGB buffer: flat `bg`, with a solid `fg` rectangle inset by `inset`. */
    const frame = (w: number, h: number, bg: [number,number,number], fg: [number,number,number], inset: number) => {
      const px = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const inside = x >= inset && y >= inset && x < w - inset && y < h - inset;
        const c = inside ? fg : bg;
        const i = (y * w + x) * 3;
        px[i] = c[0]; px[i+1] = c[1]; px[i+2] = c[2];
      }
      return px;
    };
    const W = 40, H = 40, INSET = 10;
    const BLACK: [number,number,number] = [0,0,0];
    const WHITE: [number,number,number] = [255,255,255];
    const BODY:  [number,number,number] = [200,60,60];

    const onBlack = frame(W,H,BLACK,BODY,INSET);
    const onWhite = frame(W,H,WHITE,BODY,INSET);

    const bgA = estimateBackground(onBlack, W, H);
    const bgB = estimateBackground(onWhite, W, H);
    check("a flat ground is found", bgA.uniform && bgB.uniform, [bgA, bgB]);
    check("and read correctly", bgA.colour.r === 0 && bgB.colour.r === 255, [bgA.colour, bgB.colour]);
    check("a ground swap is detected", backgroundChanged(bgA.colour, bgB.colour));
    check("an unchanged ground is not", !backgroundChanged(bgA.colour, bgA.colour));

    const mA = subjectMask(onBlack, W, H, bgA.colour);
    const mB = subjectMask(onWhite, W, H, bgB.colour);
    const subjectPixels = (W - 2*INSET) * (H - 2*INSET);
    check("the subject is the non-background", mA.reduce((n,v)=>n+v,0) === subjectPixels, mA.reduce((n,v)=>n+v,0));
    check("and is the same subject on either ground", mB.reduce((n,v)=>n+v,0) === subjectPixels);

    const core = erodeMask(intersectMasks(mA, mB), W, H, 2);
    const eroded = (W - 2*INSET - 4) * (H - 2*INSET - 4);
    check("erosion drops the silhouette band", core.reduce((n,v)=>n+v,0) === eroded, core.reduce((n,v)=>n+v,0));
    check("erosion keeps an interior to measure", core.reduce((n,v)=>n+v,0) > 0);

    /*
     * THE case this exists for. Same character, ground flipped black to white.
     * Every pixel in the eroded core is identical, so the score must be zero —
     * the previous edge-weighted metric scored this class of change at 91-95%.
     */
    let coreChanged = 0, coreSampled = 0;
    for (let i = 0; i < W*H; i++) {
      if (!core[i]) continue;
      coreSampled++;
      const p = i*3;
      if (Math.abs(onBlack[p]-onWhite[p]) > 10) coreChanged++;
    }
    check("a pure background swap scores ZERO subject change", coreChanged === 0, {coreChanged, coreSampled});
    check("and there is a real sample behind that zero", coreSampled === eroded);

    // A real repaint still registers, so the guard is not simply disabled.
    const repainted = frame(W,H,WHITE,[40,180,90],INSET);
    const mR = subjectMask(repainted, W, H, estimateBackground(repainted,W,H).colour);
    const coreR = erodeMask(intersectMasks(mA, mR), W, H, 2);
    let rChanged = 0, rSampled = 0;
    for (let i = 0; i < W*H; i++) {
      if (!coreR[i]) continue;
      rSampled++;
      const p = i*3;
      if (Math.abs(onBlack[p]-repainted[p]) > 10) rChanged++;
    }
    check("a genuinely different subject still scores high", rSampled > 0 && rChanged / rSampled > 0.9, {rChanged, rSampled});
  }
  {
    // A photograph has no flat ground, so nothing is masked off and the whole
    // frame is measured rather than an invented background being excluded.
    const noisy = new Uint8Array(30*30*3);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 37) % 256;
    const bg = estimateBackground(noisy, 30, 30);
    check("a busy frame reports no flat ground", !bg.uniform);
    const m = subjectMask(noisy, 30, 30, null);
    check("and then everything counts as subject", m.every(v => v === 1));
  }
  {
    // Tolerance: near-background pixels are background, so JPEG noise on a flat
    // ground does not become a subject speckled across the frame.
    const px = new Uint8Array(20*20*3).fill(10);
    const bg = estimateBackground(px, 20, 20);
    const m = subjectMask(px, 20, 20, bg.colour);
    check("noise within tolerance is still background", m.every(v => v === 0));
    check("the tolerance is a real number", BACKGROUND_TOLERANCE > 0 && BACKGROUND_TOLERANCE < 128);
  }

  return results;
}
