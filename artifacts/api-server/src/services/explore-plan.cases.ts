/**
 * Stage 03 Explore-plan cases, shared by the vitest suite and the tsx runner.
 *
 * Same reason as the other three cases files: vitest cannot start on the
 * development Mac, so the invariants have to be executable without it.
 *
 * What is worth protecting here: the spread is always eight takes on two named
 * axes; off-brief takes are flagged and never dropped; a malformed model
 * proposal falls back rather than producing a spread whose stated structure is a
 * lie; and every intent has a usable fallback pair.
 */

import { INTENTS, type Intent } from "../lib/intents.js";
import {
  AXIS_A_POSITIONS,
  AXIS_B_POSITIONS,
  FALLBACK_AXES,
  SPREAD_SIZE,
  buildExploreGrid,
  buildExplorePlan,
  spreadCostCents,
  validateAxes,
  type Axis,
} from "./explore-plan.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const pos = (key: string, departure = false) => ({
  key,
  label: key,
  directive: `do ${key}`,
  departure,
});

const goodProposal = () => ({
  a: { name: "Loudness", positions: [pos("p0"), pos("p1"), pos("p2", true), pos("p3", true)] },
  b: { name: "Distance", positions: [pos("q0"), pos("q1")] },
});

export function collectExplorePlanCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------------- grid
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check(`the spread is always ${SPREAD_SIZE} takes`, takes.length === SPREAD_SIZE, takes.length);
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check("take ids are unique", new Set(takes.map(t => t.id)).size === takes.length, takes.map(t => t.id));
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    const coords = takes.map(t => `${t.row},${t.col}`);
    check("every grid cell is filled exactly once", new Set(coords).size === SPREAD_SIZE, coords);
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check(
      "reading order is left to right then top to bottom",
      takes[0].row === 0 && takes[0].col === 0 && takes[AXIS_A_POSITIONS - 1].col === AXIS_A_POSITIONS - 1 && takes[AXIS_A_POSITIONS].row === 1,
      takes.map(t => `${t.row}${t.col}`).join(" "),
    );
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check(
      "every take names both of its axis positions",
      takes.every(t => !!t.axisA.name && !!t.axisA.label && !!t.axisB.name && !!t.axisB.label),
      takes[0],
    );
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check(
      "every take carries both axis directives",
      takes.every(t => t.directive.includes(";") && t.directive.length > 10),
      takes[0]?.directive,
    );
  }

  // -------------------------------------------------------------- off brief
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    const flagged = takes.filter(t => t.offBrief !== null);
    check("some takes are flagged off brief", flagged.length > 0, flagged.length);
    check("but not all of them are", flagged.length < takes.length, flagged.length);
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    check(
      "an off-brief take is flagged, never dropped",
      takes.length === SPREAD_SIZE && takes.some(t => t.offBrief !== null),
      takes.length,
    );
  }
  {
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    const flagged = takes.find(t => t.offBrief !== null)!;
    check(
      "an off-brief flag names the axis and gives a reason",
      flagged.offBrief!.axes.length > 0 && flagged.offBrief!.reason.length > 10,
      flagged.offBrief,
    );
  }
  {
    // Position 0 on both axes is the brief taken literally, so it must be clean.
    const takes = buildExploreGrid(FALLBACK_AXES.awareness);
    const origin = takes.find(t => t.row === 0 && t.col === 0)!;
    check("the origin take is never off brief", origin.offBrief === null, origin);
  }
  {
    const axes = {
      a: { id: "a" as const, name: "A", positions: [pos("p0"), pos("p1"), pos("p2", true), pos("p3")] },
      b: { id: "b" as const, name: "B", positions: [pos("q0"), pos("q1", true)] },
    };
    const takes = buildExploreGrid(axes);
    const both = takes.find(t => t.col === 2 && t.row === 1)!;
    check("a take off brief on both axes names both", both.offBrief?.axes.length === 2, both.offBrief);
  }

  // -------------------------------------------------------------- fallbacks
  for (const intent of INTENTS) {
    const axes = FALLBACK_AXES[intent as Intent];
    check(
      `${intent} has a fallback pair with the right shape`,
      axes.a.positions.length === AXIS_A_POSITIONS && axes.b.positions.length === AXIS_B_POSITIONS,
      [axes.a.positions.length, axes.b.positions.length],
    );
    check(
      `${intent} fallback axes are both named`,
      axes.a.name.trim().length > 0 && axes.b.name.trim().length > 0,
      [axes.a.name, axes.b.name],
    );
    check(
      `${intent} fallback offers at least one departure`,
      axes.a.positions.some(p => p.departure),
      axes.a.positions.map(p => p.departure),
    );
    check(
      `${intent} fallback keeps at least one on-brief take`,
      buildExploreGrid(axes).some(t => t.offBrief === null),
      intent,
    );
    check(
      `${intent} fallback position keys are unique`,
      new Set(axes.a.positions.map(p => p.key)).size === AXIS_A_POSITIONS,
      axes.a.positions.map(p => p.key),
    );
  }

  // ------------------------------------------------------------- validation
  {
    check("a well formed proposal is accepted", validateAxes(goodProposal()) !== null);
  }
  {
    const p = goodProposal();
    p.a.positions = p.a.positions.slice(0, 3);
    check("an axis with the wrong number of positions is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.b.positions = [...p.b.positions, pos("q2")];
    check("too many positions on axis B is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.name = "";
    check("an unnamed axis is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions[0] = { ...p.a.positions[0], directive: "" };
    check("a position with no directive is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions[0] = { ...p.a.positions[0], label: "" };
    check("a position with no label is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions[1] = { ...p.a.positions[1], key: p.a.positions[0].key };
    check("duplicate position keys are rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions = p.a.positions.map(x => ({ ...x, departure: false }));
    check("an axis A with no departure is rejected, it would not explore", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions = p.a.positions.map(x => ({ ...x, departure: true }));
    p.b.positions = p.b.positions.map(x => ({ ...x, departure: true }));
    check("a proposal where nothing is on brief is rejected", validateAxes(p) === null);
  }
  {
    const p = goodProposal();
    p.a.positions[0] = { ...p.a.positions[0], label: "x".repeat(40) };
    check("an over-long position label is rejected", validateAxes(p) === null);
  }
  for (const junk of [null, undefined, "nope", 7, [], {}] as unknown[]) {
    check(`junk proposal ${JSON.stringify(junk) ?? "undefined"} is rejected`, validateAxes(junk) === null);
  }

  // ------------------------------------------------------------------- plan
  {
    const plan = buildExplorePlan({ intent: "awareness", perImageUsd: 0.06 });
    check("with no proposal the plan falls back and says so", plan.fallback === true, plan.fallback);
    check("the fallback plan still has the full spread", plan.takes.length === SPREAD_SIZE, plan.takes.length);
  }
  {
    const plan = buildExplorePlan({ intent: "awareness", proposedAxes: goodProposal(), perImageUsd: 0.06 });
    check("a valid proposal is used and not marked fallback", plan.fallback === false, plan.fallback);
    check("the proposed axis name is carried through", plan.axes.a.name === "Loudness", plan.axes.a.name);
  }
  {
    const plan = buildExplorePlan({ intent: "awareness", proposedAxes: { a: 1 }, perImageUsd: 0.06 });
    check("a malformed proposal silently falls back rather than half-applying", plan.fallback === true, plan.fallback);
    check("and the fallback spread is still complete", plan.takes.length === SPREAD_SIZE, plan.takes.length);
  }
  {
    const plan = buildExplorePlan({ intent: "retention", perImageUsd: 0.06 });
    check("cost is the per-image estimate times the spread", plan.costCents === 48, plan.costCents);
  }
  {
    const plan = buildExplorePlan({ intent: "retention", perImageUsd: 0.06 });
    check(
      "offBriefCount matches the flagged takes",
      plan.offBriefCount === plan.takes.filter(t => t.offBrief !== null).length,
      plan.offBriefCount,
    );
  }
  {
    check("cost rounds to whole cents", spreadCostCents(0.0601, 8) === 48, spreadCostCents(0.0601, 8));
  }
  {
    const a = buildExplorePlan({ intent: "education", perImageUsd: 0.06 });
    const b = buildExplorePlan({ intent: "education", perImageUsd: 0.06 });
    check(
      "planning is deterministic",
      a.takes.map(t => t.id).join(",") === b.takes.map(t => t.id).join(","),
      [a.takes.length, b.takes.length],
    );
  }
  {
    // A plan must never cost nothing: a free spread would mean nothing generates.
    const plan = buildExplorePlan({ intent: "awareness", perImageUsd: 0.06 });
    check("the plan states a non-zero price", plan.costCents > 0, plan.costCents);
  }
  {
    const axes: { a: Axis; b: Axis } = FALLBACK_AXES.awareness;
    const plan = buildExplorePlan({ intent: "awareness", proposedAxes: axes, perImageUsd: 0.06 });
    check("the fallback pair itself passes validation", plan.fallback === false, plan.fallback);
  }

  return cases;
}
