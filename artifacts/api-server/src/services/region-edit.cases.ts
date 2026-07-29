/**
 * Region-edit cases, shared by the vitest suite and the tsx runner.
 *
 * The invariants worth protecting: a bad region is REJECTED rather than repaired
 * (a silently widened mask edits pixels the user did not select, which is the
 * exact harm the drift report exists to catch), and drift is measured OUTSIDE the
 * mask so a successful edit does not read as maximum drift.
 */

import {
  DRIFT_TOLERANCE,
  MIN_LASSO_POINTS,
  computeDriftPercent,
  driftMessage,
  driftVerdict,
  namedRegionsFrom,
  normalizeRegion,
  parseSubjectBox,
  polygonArea,
  regionAreaFraction,
} from "./region-edit.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

export function collectRegionEditCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------------- boxes
  {
    const r = normalizeRegion({ shape: "box", x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    check("a valid box survives", r?.shape === "box" && r.w === 0.3, r);
  }
  {
    const r = normalizeRegion({ shape: "box", x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    check("a box off the frame keeps its origin and clamps its far edge",
      r?.shape === "box" && Math.abs(r.x - 0.9) < 1e-9 && Math.abs(r.w - 0.1) < 1e-9, r);
  }
  {
    const r = normalizeRegion({ shape: "box", x: -0.5, y: -0.5, w: 0.3, h: 0.3 });
    check("a negative origin clamps to zero", r?.shape === "box" && r.x === 0 && r.y === 0, r);
  }
  {
    const r = normalizeRegion({ shape: "box", x: 0.1, y: 0.1, w: -0.3, h: -0.3 });
    check("a box dragged up-left is accepted by absolute size", r?.shape === "box" && r.w > 0, r);
  }
  {
    const r = normalizeRegion({ shape: "box", x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
    check("a misclick-sized box is rejected, not widened", r === null, r);
  }
  for (const bad of [
    { shape: "box", x: NaN, y: 0, w: 0.5, h: 0.5 },
    { shape: "box", x: 0, y: 0, w: "big", h: 0.5 },
    { shape: "box" },
  ]) {
    check(`a malformed box ${JSON.stringify(bad)} is rejected`, normalizeRegion(bad) === null);
  }

  // ------------------------------------------------------------------ lassos
  {
    const r = normalizeRegion({ shape: "lasso", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }] });
    check("a triangle lasso survives", r?.shape === "lasso" && r.points.length === 3, r);
  }
  {
    const r = normalizeRegion({ shape: "lasso", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    check(`fewer than ${MIN_LASSO_POINTS} points is a scribble, not an area`, r === null, r);
  }
  {
    const r = normalizeRegion({
      shape: "lasso",
      points: [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }, { x: 0.5, y: 0.501 }],
    });
    check("a degenerate lasso is rejected", r === null, r);
  }
  {
    const r = normalizeRegion({
      shape: "lasso",
      points: [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 2 }, { x: -1, y: 2 }],
    });
    check("lasso points clamp into the frame",
      r?.shape === "lasso" && r.points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), r);
  }
  {
    const r = normalizeRegion({ shape: "lasso", points: [{ x: 0, y: 0 }, "junk", { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }] });
    check("junk points are skipped, real ones kept", r?.shape === "lasso" && r.points.length === 3, r);
  }
  {
    const square = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }];
    check("polygon area is correct", Math.abs(polygonArea(square) - 0.25) < 1e-9, polygonArea(square));
  }
  {
    const cw = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }];
    const ccw = [...cw].reverse();
    check("winding order does not change the area", Math.abs(polygonArea(cw) - polygonArea(ccw)) < 1e-9);
  }

  // ------------------------------------------------------------------ points
  {
    const r = normalizeRegion({ shape: "point", x: 0.5, y: 0.5, r: 0.1 });
    check("a valid point survives", r?.shape === "point" && r.r === 0.1, r);
  }
  {
    const r = normalizeRegion({ shape: "point", x: 0.5, y: 0.5, r: 5 });
    check("an absurd radius is capped at half the frame", r?.shape === "point" && r.r === 0.5, r);
  }
  {
    const r = normalizeRegion({ shape: "point", x: 0.5, y: 0.5, r: 0.0001 });
    check("a pinprick point is rejected", r === null, r);
  }
  for (const junk of [null, undefined, "box", 5, {}, { shape: "hexagon" }] as unknown[]) {
    check(`unknown shape ${JSON.stringify(junk) ?? "undefined"} is rejected`, normalizeRegion(junk) === null);
  }

  // -------------------------------------------------------------------- area
  {
    const box = normalizeRegion({ shape: "box", x: 0, y: 0, w: 0.5, h: 0.4 })!;
    check("box area", Math.abs(regionAreaFraction(box) - 0.2) < 1e-9, regionAreaFraction(box));
  }
  {
    const pt = normalizeRegion({ shape: "point", x: 0.5, y: 0.5, r: 0.1 })!;
    check("point area is circular", Math.abs(regionAreaFraction(pt) - Math.PI * 0.01) < 1e-9);
  }

  // ----------------------------------------------------------- named regions
  {
    const named = namedRegionsFrom({ x: 0.3, y: 0.2, w: 0.4, h: 0.6 });
    check("a subject box yields a named Subject region",
      named.length === 1 && named[0].key === "subject" && named[0].source === "subject_box", named);
  }
  {
    const named = namedRegionsFrom(null);
    check("no subject box yields no named regions", named.length === 0, named);
  }
  {
    const named = namedRegionsFrom({ x: 0.3, y: 0.2, w: 0.4, h: 0.6 }, "bottom-right");
    const mark = named.find(n => n.key === "mark");
    check("a mark placement yields a corner region", !!mark && mark.source === "mark_placement", named);
    check("bottom-right sits at the far corner",
      !!mark && mark.region.shape === "box" && mark.region.x > 0.5 && mark.region.y > 0.5, mark);
  }
  {
    const named = namedRegionsFrom({ x: 0.3, y: 0.2, w: 0.4, h: 0.6 }, "top-left");
    const mark = named.find(n => n.key === "mark")!;
    check("top-left sits at the origin",
      mark.region.shape === "box" && mark.region.x === 0 && mark.region.y === 0, mark);
  }
  {
    const named = namedRegionsFrom({ x: 0.3, y: 0.2, w: 0.4, h: 0.6 }, "bottom-right");
    check("every named region declares where its name came from",
      named.every(n => !!n.source), named);
  }
  {
    check("a garbage subject box parses to null", parseSubjectBox({ x: "a" }) === null);
  }

  // ------------------------------------------------------------------- drift
  {
    check("drift is a percentage of what lies outside the mask",
      computeDriftPercent(50, 200) === 25, computeDriftPercent(50, 200));
  }
  {
    check("nothing outside the mask cannot drift", computeDriftPercent(10, 0) === 0);
  }
  {
    check("no change is zero drift", computeDriftPercent(0, 1000) === 0);
  }
  {
    check("everything changed is 100", computeDriftPercent(1000, 1000) === 100);
  }
  {
    check("drift cannot exceed 100 even if the counts disagree",
      computeDriftPercent(5000, 1000) === 100, computeDriftPercent(5000, 1000));
  }
  {
    check("a negative changed count floors at zero", computeDriftPercent(-5, 1000) === 0);
  }
  for (const [a, b] of [[NaN, 100], [100, NaN], [Infinity, 100]] as Array<[number, number]>) {
    check(`non-finite drift inputs (${a}, ${b}) yield 0 rather than NaN`, computeDriftPercent(a, b) === 0);
  }
  {
    check("drift is rounded to one decimal for a human reader",
      computeDriftPercent(3719, 100000) === 3.7, computeDriftPercent(3719, 100000));
  }

  // ----------------------------------------------------------------- verdict
  check("at the tolerance it is still clean", driftVerdict(DRIFT_TOLERANCE) === "clean");
  check("just past the tolerance is notable", driftVerdict(DRIFT_TOLERANCE + 0.1) === "notable");
  check("zero drift is clean", driftVerdict(0) === "clean");
  check("heavy drift reads as a repaint", driftVerdict(80) === "repainted");
  check("30 is the top of notable", driftVerdict(30) === "notable" && driftVerdict(30.1) === "repainted");
  {
    // §1.13: the report advises, it never blocks. No verdict may read as a refusal.
    for (const pct of [0, 5, 20, 90]) {
      const m = driftMessage(pct);
      check(`the drift message at ${pct}% states a number and never forbids`,
        m.includes(String(pct)) && !/cannot|blocked|refus/i.test(m), m);
    }
  }
  {
    check("the repaint message still offers to keep it", /keep it/i.test(driftMessage(90)), driftMessage(90));
  }

  return cases;
}
