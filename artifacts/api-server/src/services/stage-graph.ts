/**
 * The dependency engine for the Studio spine.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.1 to §1.5
 *
 * Everything here is a PURE FUNCTION over plain data. No database, no clock, no
 * randomness. That is deliberate: this is the highest-risk logic in the v2
 * build because every later phase assumes it is correct, and pure functions are
 * the only part of this repo that can be exhaustively verified on a machine
 * that cannot run the app.
 *
 * The three rules it enforces, in order of how easy they are to break:
 *
 *   1. STALENESS FOLLOWS `consumedFrom`, NEVER `stageNumber`. A stage that
 *      consumed nothing can never go stale, no matter what happens "upstream"
 *      of it in display order. This is what makes copy-led posts work.
 *
 *   2. A LOCKED STAGE IS AN INPUT, NOT AN OUTPUT. Locked stages are never
 *      staled. Hand-typed content locks itself, so an upstream re-run cannot
 *      silently destroy wording someone chose.
 *
 *   3. NOTHING HERE MUTATES OR REGENERATES. Every function returns a PLAN
 *      describing what would change. The caller decides, and the user is always
 *      offered "keep them as they are" beside the re-run.
 */

import {
  STAGE_ORDER,
  type StageKind,
  type StageStatus,
  type TakeOrigin,
} from "@workspace/db/schema";

/** The minimum shape the engine needs. Deliberately not the full DB row. */
export interface StageNode {
  id: string;
  stageNumber: number;
  stageKind: StageKind;
  status: StageStatus;
  /** Ids of stages this one actually consumed. The dependency graph. */
  consumedFrom: string[];
}

export interface StalePlanItem {
  id: string;
  reason: string;
}

export interface ProtectedItem {
  id: string;
  /** Why this stage survived a reopen that would otherwise have staled it. */
  why: "locked" | "authored_independently";
}

/**
 * Coerce whatever came out of the jsonb column into a list of ids.
 *
 * The schema now constrains this to a JSON array and types it as string[], but
 * this runs in an API request path and a throw here would 500 a page load. A
 * malformed row should cost that one stage its edges, not the whole request.
 *
 * Note the specific hazard being guarded: `.notNull()` does not prevent the
 * JSON value `null`, because JSON null is not SQL NULL. A row written before
 * the CHECK constraint existed can still hold one.
 */
function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export interface ReopenPlan {
  /** The stage being reopened. Never marked stale by its own reopen. */
  reopenedId: string;
  /** Stages that would become stale, in stable display order. */
  stale: StalePlanItem[];
  /** Stages that consumed the reopened stage but are protected from staling. */
  protected: ProtectedItem[];
  /**
   * True when nothing downstream is affected, so the UI can skip the
   * "re-run or keep" prompt entirely rather than showing an empty one.
   */
  isIsolated: boolean;
  /**
   * The stage being reopened is itself locked. The caller must decide whether
   * to refuse or to unlock first; without this the route would have to re-fetch
   * the target just to find out.
   */
  targetLocked: boolean;
  /**
   * Of the stale entries, those that were ALREADY stale before this reopen.
   * Prompting "re-run or keep" for a no-op transition is noise, so the UI can
   * subtract these when deciding whether to ask.
   */
  alreadyStale: string[];
}

/**
 * Every stage that transitively consumes `rootId`.
 *
 * Breadth-first with a visited set, so a malformed graph containing a cycle
 * terminates instead of hanging the request. Cycles should be impossible given
 * how stages are written, but "should be impossible" is not a runtime guarantee
 * and an infinite loop here would take down the API.
 *
 * `rootId` itself is never included: reopening a stage does not stale it.
 */
export function transitiveConsumers(stages: StageNode[], rootId: string): Set<string> {
  const byId = new Map(stages.map((s) => [s.id, s]));
  // Reverse adjacency: for each stage, who consumes it.
  const consumers = new Map<string, string[]>();
  for (const s of stages) {
    for (const dep of asIdList(s.consumedFrom)) {
      // Ignore self-references and ids that are not real stages, rather than
      // trusting the column blindly.
      if (dep === s.id || !byId.has(dep)) continue;
      const list = consumers.get(dep) ?? [];
      list.push(s.id);
      consumers.set(dep, list);
    }
  }

  const out = new Set<string>();
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of consumers.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      out.add(next);
      queue.push(next);
    }
  }
  return out;
}

/** A locked stage is an input to everything, so nothing can invalidate it. */
export function isStaleable(stage: StageNode): boolean {
  if (stage.status === "locked") return false;
  // A stage that consumed nothing has no upstream to be invalidated by. This is
  // the copy-led case: a hook written before any image existed.
  if (asIdList(stage.consumedFrom).length === 0) return false;
  return true;
}

/**
 * Why a stage escaped staling. Kept next to `isStaleable` so the predicate and
 * the explanation cannot drift apart, and so `planReopen` has one place to ask
 * rather than re-implementing the conditions inline.
 */
function protectionReason(stage: StageNode): ProtectedItem["why"] {
  return stage.status === "locked" ? "locked" : "authored_independently";
}

/**
 * What reopening a stage would do. Returns a plan; changes nothing.
 *
 * The caller is expected to present `stale` alongside a "keep them as they are"
 * option, per §1.5. Automatic regeneration is never correct here.
 */
export function planReopen(stages: StageNode[], stageId: string): ReopenPlan {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const target = byId.get(stageId);
  if (!target) {
    return {
      reopenedId: stageId, stale: [], protected: [],
      isIsolated: true, targetLocked: false, alreadyStale: [],
    };
  }

  const affected = transitiveConsumers(stages, stageId);
  const stale: StalePlanItem[] = [];
  const protectedItems: ProtectedItem[] = [];

  for (const id of affected) {
    const node = byId.get(id);
    if (!node) continue;
    // Delegating to isStaleable rather than re-testing the conditions here is
    // the point: a future change to what "staleable" means must not be able to
    // apply in one place and not the other.
    if (!isStaleable(node)) {
      protectedItems.push({ id, why: protectionReason(node) });
      continue;
    }
    stale.push({
      id,
      reason: `Built on ${target.stageKind}, which you reopened`,
    });
  }

  // Stable ordering by display position, so the UI does not reshuffle between
  // identical calls.
  const pos = (id: string) => byId.get(id)?.stageNumber ?? Number.MAX_SAFE_INTEGER;
  stale.sort((a, b) => pos(a.id) - pos(b.id));
  protectedItems.sort((a, b) => pos(a.id) - pos(b.id));

  const alreadyStale = stale
    .filter((s) => byId.get(s.id)?.status === "stale")
    .map((s) => s.id);

  return {
    reopenedId: stageId,
    stale,
    protected: protectedItems,
    // Isolated when nothing NEWLY goes stale. Re-listing rows that were already
    // stale would make the UI prompt about a transition that does not happen.
    isIsolated: stale.length === alreadyStale.length,
    targetLocked: target.status === "locked",
    alreadyStale,
  };
}

/**
 * Which way the arrow between two adjacent stages should point.
 *
 * Normally dependency runs with display order and the arrow points forward. In
 * a copy-led post, stage 03 consumes stage 04, so the arrow between them is
 * drawn reversed. Returning this from the engine rather than inferring it in the
 * component keeps one source of truth for what the graph actually says.
 */
export function dependencyEdge(
  earlier: StageNode,
  later: StageNode,
): "forward" | "inverted" | "both" | "none" {
  const laterConsumesEarlier = asIdList(later.consumedFrom).includes(earlier.id);
  const earlierConsumesLater = asIdList(earlier.consumedFrom).includes(later.id);
  // A 2-cycle is a malformed graph. Reporting "forward" for it, as an earlier
  // version did, made a cycle indistinguishable from a healthy edge AND made
  // the answer depend on argument order rather than on the graph. Naming it
  // lets the caller render something honest and lets a health check find it.
  if (laterConsumesEarlier && earlierConsumesLater) return "both";
  if (laterConsumesEarlier) return "forward";
  if (earlierConsumesLater) return "inverted";
  return "none";
}

/**
 * Whether a take should lock its stage.
 *
 * Hand-typed content locks. Without this, direct editing is a trap: you write
 * the caption you want, adjust something upstream, and lose it. See §1.4 and
 * §1.12.
 */
export function shouldAutoLock(origin: TakeOrigin): boolean {
  return origin === "user_typed";
}

/** The next take index for a slot. 1-based, so "3 / 5" reads naturally. */
export function nextTakeIndex(existing: Array<{ slotKey: string; takeIndex: number }>, slotKey: string): number {
  // Guard the inputs rather than trusting them: a NaN or fractional takeIndex
  // would propagate into an integer column, and Math.max(...) on a very large
  // array overflows the call stack. reduce avoids the spread entirely.
  const highest = existing.reduce((max, t) => {
    if (t.slotKey !== slotKey) return max;
    const n = t.takeIndex;
    if (!Number.isInteger(n) || n < 1) return max;
    return n > max ? n : max;
  }, 0);
  return highest + 1;
}

/**
 * The five stages a new creative starts with.
 *
 * All `empty`, all consuming nothing. Dependencies are recorded as work is
 * actually done, which is the only way `consumedFrom` can stay truthful: a
 * pre-wired chain would encode display order as dependency and reintroduce
 * exactly the bug this design exists to avoid.
 */
export function initialSpine(): Array<Pick<StageNode, "stageNumber" | "stageKind" | "status" | "consumedFrom">> {
  return STAGE_ORDER.map((kind, i) => ({
    stageNumber: i + 1,
    stageKind: kind,
    status: "empty" as StageStatus,
    consumedFrom: [],
  }));
}

/**
 * Recording that a stage consumed some inputs. Idempotent and self-cleaning:
 * duplicates collapse and self-references are dropped, so repeated generation
 * on the same stage cannot inflate the graph.
 */
export function withConsumed(stage: StageNode, consumedIds: string[]): StageNode {
  const merged = new Set(asIdList(stage.consumedFrom));
  for (const id of consumedIds) {
    if (id && id !== stage.id) merged.add(id);
  }
  return { ...stage, consumedFrom: [...merged] };
}

/**
 * Human-readable summary of a reopen, for the bar that offers the re-run.
 * Deliberately says what is affected rather than what broke, per §1.14.
 */
export function describeReopen(plan: ReopenPlan, stages: StageNode[]): string {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const label = (id: string) => byId.get(id)?.stageKind ?? "stage";
  if (plan.stale.length === 0) {
    return "Nothing downstream was built on this, so nothing else is affected.";
  }
  const names = plan.stale.map((s) => label(s.id));
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  // Describe protection by its actual reason. Hardcoding "locked" here would
  // mislabel a stage that survived because it was authored independently.
  const lockedCount = plan.protected.filter((p) => p.why === "locked").length;
  const independentCount = plan.protected.length - lockedCount;
  const parts: string[] = [];
  if (lockedCount > 0) parts.push(`${lockedCount} locked`);
  if (independentCount > 0) parts.push(`${independentCount} independently authored`);
  const protectedNote =
    parts.length > 0
      ? ` ${parts.join(" and ")} ${plan.protected.length === 1 ? "stage is" : "stages are"} untouched.`
      : "";
  return `${list} ${plan.stale.length === 1 ? "was" : "were"} built on this, so ${plan.stale.length === 1 ? "it is" : "they are"} marked stale.${protectedNote}`;
}
