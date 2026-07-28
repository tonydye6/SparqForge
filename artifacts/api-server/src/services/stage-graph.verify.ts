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

// ============================================================================
// Cases added after the Phase 3 adversarial review. Each one corresponds to a
// finding: the engine passed 41 assertions while still having a crash path,
// which is a good reminder that a green suite proves only what it asked.
// ============================================================================

// --- CRITICAL: malformed consumedFrom must degrade, never throw -------------
/**
 * The review's top finding. `.notNull()` on a jsonb column does NOT prevent the
 * JSON value `null`, because JSON null is not SQL NULL, so a row written before
 * the CHECK constraint existed can still hold one. Iterating it threw a
 * TypeError inside an API request path.
 */
const badTypes: StageNode[] = [
  { ...node("s1", 1, []) },
  { ...node("s2", 2, []), consumedFrom: null as unknown as string[] },
  { ...node("s3", 3, []), consumedFrom: {} as unknown as string[] },
  { ...node("s4", 4, []), consumedFrom: "s1" as unknown as string[] },
  { ...node("s5", 5, []), consumedFrom: [null, 42, "", "s1"] as unknown as string[] },
];
let threw = false;
let badPlan: ReturnType<typeof planReopen> | null = null;
try {
  badPlan = planReopen(badTypes, "s1");
} catch {
  threw = true;
}
check("malformed consumedFrom does not throw", threw === false);
check("a JSON null consumedFrom is treated as no dependencies",
  isStaleable(badTypes[1]) === false);
check("an object consumedFrom is treated as no dependencies",
  isStaleable(badTypes[2]) === false);
check("a bare string consumedFrom is not iterated character by character",
  isStaleable(badTypes[3]) === false);
check("non-string entries are filtered but valid ones survive",
  badPlan !== null && badPlan.stale.map((s) => s.id).join() === "s5",
  badPlan?.stale);

// --- planReopen on a locked or already-stale target -------------------------
const lockedTarget: StageNode[] = [
  node("s1", 1, [], "locked"),
  node("s2", 2, ["s1"]),
];
check("reopening a locked stage is flagged to the caller",
  planReopen(lockedTarget, "s1").targetLocked === true);
check("reopening an unlocked stage is not flagged",
  planReopen(linear, "s2").targetLocked === false);

const alreadyStaleChain: StageNode[] = [
  node("s1", 1, []),
  node("s2", 2, ["s1"], "stale"),
  node("s3", 3, ["s2"], "stale"),
];
const staleAgain = planReopen(alreadyStaleChain, "s1");
check("already-stale stages are reported as already stale",
  staleAgain.alreadyStale.sort().join() === "s2,s3",
  staleAgain.alreadyStale);
check("a reopen that changes nothing new counts as isolated",
  staleAgain.isIsolated === true);

// --- the predicate and the planner must agree -------------------------------
/**
 * The review's finding #2: planReopen duplicated isStaleable's conditions
 * inline, so a change to one would silently not apply to the other, and every
 * existing assertion would still pass. This binds them.
 */
const mixed: StageNode[] = [
  node("m1", 1, []),
  node("m2", 2, ["m1"], "done"),
  node("m3", 3, ["m1"], "locked"),
  node("m4", 4, ["m1"], "active"),
  node("m5", 5, ["m1"], "empty"),
];
const mixedPlan = planReopen(mixed, "m1");
const expectedStale = mixed.filter((s) => s.id !== "m1" && isStaleable(s)).map((s) => s.id);
check("planReopen's stale set equals exactly the isStaleable members",
  mixedPlan.stale.map((s) => s.id).sort().join() === expectedStale.sort().join(),
  { got: mixedPlan.stale.map((s) => s.id), expected: expectedStale });
check("every non-staleable affected stage appears as protected",
  mixedPlan.protected.map((p) => p.id).join() === "m3");

// --- arrows: 2-cycles and swapped arguments ---------------------------------
const twoCycleA = node("a", 3, ["b"]);
const twoCycleB = node("b", 4, ["a"]);
check("a 2-cycle is reported as both, not silently as forward",
  dependencyEdge(twoCycleA, twoCycleB) === "both");
check("a 2-cycle reports the same answer whichever way it is called",
  dependencyEdge(twoCycleA, twoCycleB) === dependencyEdge(twoCycleB, twoCycleA));
check("swapping arguments on a real edge inverts the answer",
  dependencyEdge(linear[2], linear[1]) === "inverted" &&
  dependencyEdge(linear[1], linear[2]) === "forward");

// --- disconnected components ------------------------------------------------
const twoComponents: StageNode[] = [
  node("a1", 1, []),
  node("a2", 2, ["a1"]),
  node("b1", 3, []),
  node("b2", 4, ["b1"]),
];
const compPlan = planReopen(twoComponents, "a1");
check("reopening in one component leaves the other entirely alone",
  compPlan.stale.map((s) => s.id).join() === "a2" && compPlan.protected.length === 0,
  { stale: compPlan.stale, protected: compPlan.protected });

// --- a cycle embedded in a longer chain -------------------------------------
const cycleInChain: StageNode[] = [
  node("c1", 1, []),
  node("c2", 2, ["c1", "c3"]),
  node("c3", 3, ["c2"]),
  node("c4", 4, ["c3"]),
  node("c5", 5, ["c4"]),
];
const beyond = transitiveConsumers(cycleInChain, "c1");
check("a cycle mid-chain does not stop traversal reaching the tail",
  [...beyond].sort().join() === "c2,c3,c4,c5", [...beyond]);

// --- take index hazards ------------------------------------------------------
check("a NaN take index cannot poison the next index",
  nextTakeIndex([{ slotKey: "i", takeIndex: NaN }], "i") === 1);
check("a fractional take index is ignored rather than propagated",
  nextTakeIndex([{ slotKey: "i", takeIndex: 1.5 }], "i") === 1);
check("a negative take index is ignored",
  nextTakeIndex([{ slotKey: "i", takeIndex: -3 }], "i") === 1);
check("a very large slot history does not overflow the stack",
  nextTakeIndex(
    Array.from({ length: 200_000 }, (_, k) => ({ slotKey: "i", takeIndex: k + 1 })),
    "i",
  ) === 200_001);

// --- shared array references -------------------------------------------------
/**
 * Two nodes handed the SAME array instance. withConsumed must not write
 * through it, or editing one stage would silently edit another.
 */
const shared: string[] = ["s1"];
const nodeX = { ...node("x", 2, []), consumedFrom: shared };
const nodeY = { ...node("y", 3, []), consumedFrom: shared };
withConsumed(nodeX, ["zzz"]);
check("withConsumed does not write through a shared array reference",
  shared.length === 1 && nodeY.consumedFrom.length === 1,
  { shared, y: nodeY.consumedFrom });

// --- description wording -----------------------------------------------------
/**
 * describeReopen previously hardcoded the word "locked" for every protected
 * item, which would mislabel a stage protected for a different reason.
 */
const independentProtected = describeReopen(
  {
    reopenedId: "r",
    stale: [{ id: "s2", reason: "x" }],
    protected: [{ id: "s9", why: "authored_independently" }],
    isIsolated: false,
    targetLocked: false,
    alreadyStale: [],
  },
  [node("r", 1, []), node("s2", 2, ["r"]), node("s9", 3, [])],
);
check("an independently authored stage is not described as locked",
  independentProtected.includes("independently authored") &&
  !independentProtected.includes("locked"),
  independentProtected);

// ------------------------------------------------------------------ report
console.log(`\nstage-graph verification: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("all assertions pass\n");
