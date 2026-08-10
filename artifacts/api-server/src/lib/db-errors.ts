/**
 * Reading a constraint name off a drizzle error.
 *
 * THE TRAP THIS EXISTS FOR. Drizzle's thrown `Error.message` is the FAILED SQL
 * PLUS ITS BOUND PARAMETERS. Matching a constraint name against that string
 * never fires, and returning it to a client leaks the query and its values. The
 * name lives on the DRIVER error, which drizzle wraps: walk `cause`.
 *
 * Found by walking an endpoint rather than by reading it. Lifted out of
 * routes/sequences.ts, where it was written, the first time a second route
 * needed it.
 */
export function constraintOf(err: unknown): string | null {
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor; depth += 1) {
    const name = (cursor as { constraint?: unknown }).constraint;
    if (typeof name === "string") return name;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}
