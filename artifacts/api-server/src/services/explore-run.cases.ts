/**
 * Explore-run cases, shared by the vitest suite and the tsx runner.
 *
 * These are the money rules and the partial-failure rules, which is why they are
 * pure and tested here rather than left inside the route: this is the first path
 * in the Studio that spends real money, and a rounding or attribution mistake
 * here is a billing mistake.
 */

import {
  RUN_CONCURRENCY,
  axisDirectiveBlock,
  mapWithConcurrency,
  reservationUsd,
  settledCostUsd,
  takeErrorMessage,
  takeFilename,
  type TakeOutcome,
} from "./explore-run.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const outcome = (id: string, ok: boolean): TakeOutcome =>
  ok ? { takeId: id, ok: true, imageUrl: `/api/files/generated/${id}.png` } : { takeId: id, ok: false, error: "x" };

export async function collectExploreRunCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------------ money
  check("reservation is the whole spread up front", reservationUsd(8, 0.06) === 0.48, reservationUsd(8, 0.06));
  check("a fully successful run settles at the reservation",
    settledCostUsd(Array.from({ length: 8 }, (_, i) => outcome(`t${i}`, true)), 0.06) === 0.48);
  check("a partial run charges only for what arrived",
    Math.abs(settledCostUsd([outcome("a", true), outcome("b", true), outcome("c", false)], 0.06) - 0.12) < 1e-9,
    settledCostUsd([outcome("a", true), outcome("b", true), outcome("c", false)], 0.06));
  check("a total failure charges nothing", settledCostUsd([outcome("a", false)], 0.06) === 0);
  check("an empty run charges nothing", settledCostUsd([], 0.06) === 0);
  check("settled never exceeds the reservation", (() => {
    const outs = Array.from({ length: 8 }, (_, i) => outcome(`t${i}`, true));
    return settledCostUsd(outs, 0.06) <= reservationUsd(8, 0.06);
  })());

  // --------------------------------------------------------------- filename
  {
    const f = takeFilename("cid", "spectacle__close", "tok");
    check("filename carries creative, take and token", f === "cid_explore_spectacle__close_tok.png", f);
  }
  {
    const f = takeFilename("cid", "a/../../b", "tok");
    check("path separators cannot escape the namespace", !f.includes("/") && !f.includes(".."), f);
  }
  {
    const a = takeFilename("cid", "t", "tok1");
    const b = takeFilename("cid", "t", "tok2");
    check("re-running a take yields a new filename, so no stale cache", a !== b, [a, b]);
  }

  // -------------------------------------------------------- axis directive
  /*
   * `briefForTake` was removed with the legacy prompt path it served: stage 03
   * now assembles the prompt through buildDirectedPrompt, which places the
   * directive itself. What survived is the WORDING, which is the part §1.17
   * depends on, because it is how a user can tell which words in the prompt came
   * from the spread rather than from them. Testing it here keeps that wording
   * single-sourced for both assemblers.
   */
  {
    const b = axisDirectiveBlock("push to spectacle");
    check("the directive is a labelled block a reader can pick out of a prompt",
      b === "FOR THIS TAKE IN THE SPREAD: push to spectacle.", b);
  }
  {
    check("the directive block adds the sentence stop and nothing else",
      axisDirectiveBlock("x") === "FOR THIS TAKE IN THE SPREAD: x.", axisDirectiveBlock("x"));
  }

  // ------------------------------------------------------------ concurrency
  {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    check("results come back in input order",
      out.every(r => r.ok) && out.map(r => (r as { value: number }).value).join(",") === "2,4,6,8,10",
      out);
  }
  {
    let inFlight = 0, peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--; return 1;
    });
    check("concurrency is bounded", peak <= 3, peak);
  }
  {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    check("one failure does not lose the other results",
      out[0].ok && !out[1].ok && out[2].ok, out.map(r => r.ok));
  }
  {
    // The whole point: seven good takes must survive one bad one.
    const out = await mapWithConcurrency(Array.from({ length: 8 }, (_, i) => i), 3, async (n) => {
      if (n === 4) throw new Error("boom");
      return n;
    });
    check("seven of eight survive a single failure", out.filter(r => r.ok).length === 7, out.filter(r => r.ok).length);
  }
  {
    const out = await mapWithConcurrency([], 3, async () => 1);
    check("an empty list is not an error", out.length === 0);
  }
  {
    const out = await mapWithConcurrency([1], 0, async (n) => n);
    check("a zero limit still makes progress rather than deadlocking", out.length === 1 && out[0].ok, out);
  }
  check(`default concurrency is ${RUN_CONCURRENCY} and below the spread size`, RUN_CONCURRENCY > 0 && RUN_CONCURRENCY < 8);

  // ------------------------------------------------------------------ errors
  {
    const m = takeErrorMessage(new Error("upstream 503"));
    check("failure copy says what it affects", m.includes("missing from the spread"), m);
    check("failure copy is bounded in length", m.length <= 300, m.length);
  }
  {
    const m = takeErrorMessage("x".repeat(500));
    check("a huge upstream string is truncated", m.length <= 300, m.length);
  }

  return cases;
}
