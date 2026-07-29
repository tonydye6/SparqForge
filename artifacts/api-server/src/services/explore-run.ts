/**
 * Stage 03 · Image · running the Explore spread.
 *
 * The pure half of the run: how many images to attempt, what each one costs,
 * what to charge for a partial run, and how to name the files. The route does
 * the I/O. Keeping the arithmetic here means the money rules are testable on a
 * machine that cannot start vitest, which matters more for this file than for
 * any other in the Studio: it is the first thing that spends real money.
 */

/**
 * Concurrent image calls per run.
 *
 * Eight at once is a burst the upstream will throttle and the container will
 * feel, and a throttled call fails a take the user has already been charged
 * headroom for. Three keeps a spread comfortably inside a minute while leaving
 * room for anything else the account is doing.
 */
export const RUN_CONCURRENCY = 3;

export interface TakeOutcome {
  takeId: string;
  ok: boolean;
  /** Present when ok. */
  imageUrl?: string;
  /** Present when not ok. Written for a person, per §1.14. */
  error?: string;
}

/**
 * What the run actually cost, given what actually succeeded.
 *
 * Charging for the whole spread when three takes failed would bill for pictures
 * nobody received. Charging nothing would hide real spend, because a failed
 * generation can still be billable upstream. We charge for successes, which is
 * the number we can defend, and the route records the failure count alongside it
 * so the discrepancy is visible rather than quietly absorbed.
 */
export function settledCostUsd(outcomes: TakeOutcome[], perImageUsd: number): number {
  return outcomes.filter(o => o.ok).length * perImageUsd;
}

/** Worst case, reserved up front before anything is attempted. */
export function reservationUsd(takeCount: number, perImageUsd: number): number {
  return takeCount * perImageUsd;
}

/**
 * Storage filename for one take.
 *
 * Token-named so a client can never serve a stale cached image for a re-run of
 * the same take, which is the same reason the composite path does it.
 */
export function takeFilename(creativeId: string, takeId: string, token: string): string {
  const safeTake = takeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${creativeId}_explore_${safeTake}_${token}.png`;
}

/**
 * The axis directive as its own labelled block.
 *
 * A labelled block rather than prose folded into the brief, because §1.17
 * requires that nothing sent to the model is hidden from the user: this is how
 * the prompt delta can show which words came from the spread rather than from
 * the person.
 *
 * This replaced `briefForTake`, which appended the block to an AssembledContext's
 * combinedBrief. That signature only made sense for the legacy prompt assembler
 * stage 03 no longer uses; `buildDirectedPrompt` places the directive itself,
 * between the reference roll-call and the brand constraints. Keeping the old
 * function for its tests would have left dead code that passes, which this
 * project has been bitten by before.
 */
export function axisDirectiveBlock(directive: string): string {
  return `FOR THIS TAKE IN THE SPREAD: ${directive}.`;
}

/**
 * Run tasks with a bounded number in flight.
 *
 * Results come back in input order regardless of completion order, so a take's
 * outcome always lines up with its grid position. Nothing here throws: a task
 * that rejects is the caller's to represent as a failed outcome, because losing
 * seven good takes to one bad one would be the worst possible failure mode for
 * something the user has already paid for.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await task(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/** Failure copy for a take. Says what it affects and whose fault it is (§1.14). */
export function takeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Never surface a bare upstream string as though it were our own diagnosis,
  // and never blame the platform for something we cannot attribute.
  return `This take did not render, so it is missing from the spread. ${raw}`.slice(0, 300);
}
