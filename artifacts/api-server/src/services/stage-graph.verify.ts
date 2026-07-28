/**
 * Executable verification for the stage dependency engine.
 *
 * Run: pnpm exec tsx src/services/stage-graph.verify.ts   (from artifacts/api-server)
 *
 * This exists because vitest cannot run on the development Mac: the
 * Linux-resolved lockfile omits @rollup/rollup-darwin-arm64. The engine is the
 * highest-risk logic in the v2 build, so it needs verification that runs
 * somewhere rather than verification that runs nowhere. These same cases should
 * be lifted into a real vitest file so CI on Replit runs them too.
 */

import {
  transitiveConsumers,
  isStaleable,
  planReopen,
  dependencyEdge,
  shouldAutoLock,
  nextTakeIndex,
  initialSpine,
  withConsumed,
  describeReopen,
  type StageNode,
} from "./stage-graph.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail === undefined ? "" : ` · got ${JSON.stringify(detail)}`}`);
  }
}

function node(
  id: string,
  stageNumber: number,
  consumedFrom: string[] = [],
  status: StageNode["status"] = "done",
): StageNode {
  const kinds = ["brief", "direction", "asset", "copy", "crops"] as const;
  return { id, stageNumber, stageKind: kinds[stageNumber - 1], status, consumedFrom };
}

/** A normal post: each stage consumed the one before it. */
const linear: StageNode[] = [
  node("s1", 1, []),
  node("s2", 2, ["s1"]),
  node("s3", 3, ["s2"]),
  node("s4", 4, ["s3"]),
  node("s5", 5, ["s4"]),
];

// ---------------------------------------------------------------- traversal
check("linear: reopening s2 reaches s3, s4, s5",
  [...transitiveConsumers(linear, "s2")].sort().join() === "s3,s4,s5",
  [...transitiveConsumers(linear, "s2")]);

check("a stage is never its own consumer", !transitiveConsumers(linear, "s2").has("s2"));

check("reopening the last stage affects nothing",
  transitiveConsumers(linear, "s5").size === 0);

// A diamond: two stages consume s1, and s4 consumes both.
const diamond: StageNode[] = [
  node("s1", 1, []),
  node("s2", 2, ["s1"]),
  node("s3", 3, ["s1"]),
  node("s4", 4, ["s2", "s3"]),
];
check("diamond: each affected stage appears exactly once",
  [...transitiveConsumers(diamond, "s1")].sort().join() === "s2,s3,s4");

// Cycle safety. Should be unreachable in practice; must still terminate.
const cyclic: StageNode[] = [
  node("a", 1, ["c"]),
  node("b", 2, ["a"]),
  node("c", 3, ["b"]),
];
const cycleResult = transitiveConsumers(cyclic, "a");
/**
 * Two properties at once. It terminated, which is the point. And it yielded
 * {b, c} rather than {a, b, c}: the traversal came back around to `a` and
 * correctly refused to include the root, because reopening a stage never stales
 * itself. My first version of this assertion expected 3 and was simply wrong.
 */
check("a cycle terminates rather than hanging",
  cycleResult.size === 2 && !cycleResult.has("a"), [...cycleResult]);

// Malformed data must degrade, not throw.
const malformed: StageNode[] = [
  node("s1", 1, ["ghost"]),   // references a stage that does not exist
  node("s2", 2, ["s2"]),      // references itself
  node("s3", 3, ["s1"]),
];
check("unknown ids in consumedFrom are ignored",
  [...transitiveConsumers(malformed, "s1")].join() === "s3");
check("self-references are ignored", !transitiveConsumers(malformed, "s2").has("s2"));

// ---------------------------------------------------- the copy-led invariant
/**
 * The whole reason this design exists. Copy sits at display position 4 but was
 * authored first, so it consumed nothing. Reopening the asset stage must NOT
 * touch it, even though 3 comes before 4 in the row.
 */
const copyLed: StageNode[] = [
  node("s1", 1, []),
  node("s2", 2, ["s1"]),
  node("s3", 3, ["s2", "s4"]), // the image was built to fit the locked line
  node("s4", 4, [], "locked"), // copy: authored first, locked
  node("s5", 5, ["s3"]),
];

const copyLedPlan = planReopen(copyLed, "s3");
check("copy-led: reopening the asset stales crops",
  copyLedPlan.stale.map((s) => s.id).join() === "s5",
  copyLedPlan.stale);
check("copy-led: locked copy is never staled",
  !copyLedPlan.stale.some((s) => s.id === "s4"));

/**
 * The critical negative case: stage 04 is LATER in display order than 03, and
 * 03 consumed it, so reopening 04 legitimately stales 03. Position did not
 * decide this; the edge did.
 */
const reverseePlan = planReopen(copyLed, "s4");
check("dependency, not position: reopening later stage 04 stales earlier stage 03",
  reverseePlan.stale.some((s) => s.id === "s3"),
  reverseePlan.stale);

check("independent stages are not staleable",
  isStaleable(node("x", 4, [])) === false);
check("locked stages are not staleable",
  isStaleable(node("x", 4, ["s1"], "locked")) === false);
check("a normal dependent stage is staleable",
  isStaleable(node("x", 4, ["s1"])) === true);

// ------------------------------------------------------------------- plans
const linearPlan = planReopen(linear, "s2");
check("plan lists stale stages in display order",
  linearPlan.stale.map((s) => s.id).join() === "s3,s4,s5",
  linearPlan.stale);
check("plan is not isolated when something is affected", linearPlan.isIsolated === false);
check("plan is isolated when nothing is affected", planReopen(linear, "s5").isIsolated === true);
check("reopening an unknown stage is safe",
  planReopen(linear, "nope").isIsolated === true);

const lockedDownstream: StageNode[] = [
  node("s1", 1, []),
  node("s2", 2, ["s1"]),
  node("s3", 3, ["s2"], "locked"),
];
const lockPlan = planReopen(lockedDownstream, "s1");
check("locked downstream stages are reported as protected, not stale",
  lockPlan.stale.map((s) => s.id).join() === "s2" &&
  lockPlan.protected.map((p) => p.id).join() === "s3",
  { stale: lockPlan.stale, protected: lockPlan.protected });

// --------------------------------------------------------------- arrows
check("arrow is forward when the later stage consumed the earlier",
  dependencyEdge(linear[1], linear[2]) === "forward");
check("arrow is inverted when the earlier stage consumed the later",
  dependencyEdge(copyLed[2], copyLed[3]) === "inverted");
check("arrow is none when there is no edge",
  dependencyEdge(node("a", 1, []), node("b", 2, [])) === "none");

// ------------------------------------------------------------ takes & locks
check("hand-typed content auto-locks", shouldAutoLock("user_typed") === true);
check("generated content does not auto-lock", shouldAutoLock("generated") === false);
check("a region edit does not auto-lock", shouldAutoLock("region_edit") === false);

const takes = [
  { slotKey: "image", takeIndex: 1 },
  { slotKey: "image", takeIndex: 2 },
  { slotKey: "caption", takeIndex: 1 },
];
check("take indexes are per slot, not global", nextTakeIndex(takes, "image") === 3);
check("a fresh slot starts at 1", nextTakeIndex(takes, "hashtags") === 1);
check("an existing single-take slot increments", nextTakeIndex(takes, "caption") === 2);

// -------------------------------------------------------------- the spine
const spine = initialSpine();
check("a new creative gets five stages", spine.length === 5);
check("stages are numbered 1..5 in order",
  spine.map((s) => s.stageNumber).join() === "1,2,3,4,5");
check("stage kinds are in canonical order",
  spine.map((s) => s.stageKind).join() === "brief,direction,asset,copy,crops");
check("NOTHING is pre-wired: a new spine has no dependencies at all",
  spine.every((s) => s.consumedFrom.length === 0));
check("a new spine is entirely empty", spine.every((s) => s.status === "empty"));

// ------------------------------------------------------------ withConsumed
const base = node("s3", 3, ["s2"]);
check("withConsumed merges without duplicating",
  withConsumed(base, ["s2", "s1"]).consumedFrom.sort().join() === "s1,s2");
check("withConsumed is idempotent",
  withConsumed(withConsumed(base, ["s1"]), ["s1"]).consumedFrom.sort().join() === "s1,s2");
check("withConsumed drops self-references",
  !withConsumed(base, ["s3"]).consumedFrom.includes("s3"));
check("withConsumed ignores empty ids",
  withConsumed(base, [""]).consumedFrom.join() === "s2");
check("withConsumed does not mutate its input",
  base.consumedFrom.join() === "s2");

// ------------------------------------------------------------ descriptions
check("isolated reopen says nothing is affected",
  describeReopen(planReopen(linear, "s5"), linear).includes("nothing else is affected"));
check("single stale reads in the singular",
  describeReopen(planReopen(copyLed, "s3"), copyLed).includes("was built on this"));
check("multiple stale reads in the plural",
  describeReopen(linearPlan, linear).includes("were built on this"));
check("protected stages are mentioned",
  describeReopen(lockPlan, lockedDownstream).includes("locked"));

// ------------------------------------------------------------------ report
console.log(`\nstage-graph verification: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("all assertions pass\n");
