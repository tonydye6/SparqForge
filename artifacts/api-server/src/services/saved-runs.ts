/**
 * Phase 10 · saved runs and cross-brand fan-out.
 *
 * Doc 22 Phase 10 items 2 and 3: "a brief plus whichever later stages were
 * locked, replayable", and "one idea, N brand contracts, N sets of outputs".
 *
 * Everything that decides WHAT crosses a brand boundary lives here, pure, so it
 * can be read in one place and executed without a database. The route is a
 * transaction around these decisions and nothing more.
 *
 * THE QUESTION THIS FILE ANSWERS. Replaying a run into another brand is not a
 * copy. Principle 1.10: the designer decides how it is composed, the brand
 * decides what it is made of. So a director carries, a picture does not, and
 * the brand-owned lines of the brief are re-read from the brand record rather
 * than carried across. A run that copied a Crown U "must not" into a Rumble U
 * post would be quietly binding one brand with another's rules, which is the
 * exact failure Principle 1.9 exists to prevent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Nothing here generates, and nothing here
 * costs money. Replaying is free: it writes takes somebody already paid for and
 * re-derives the brand rows deterministically. The Image stage of a cross-brand
 * replay lands EMPTY on purpose, because making that picture is what the target
 * brand's contract is for.
 */

// `@workspace/db/schema` rather than `@workspace/db`: the package root builds a
// database client and throws at import without DATABASE_URL, which would make
// this module unloadable by the tsx runner. Same reason stage-graph.ts does it.
import {
  RUN_SNAPSHOT_VERSION,
  type RunSnapshot,
  type SavedRunStage,
  type StageKind,
  type TakeOrigin,
} from "@workspace/db/schema";
import {
  deriveChannels,
  deriveMustNot,
  type BrandConstraints,
  type DerivedRow,
} from "./brief-intake.js";
import { voiceCheck } from "./copy-stage.js";

// ── What a slot is made of ───────────────────────────────────────────────────

/**
 * Whether a slot's content belongs to the idea or to the brand.
 *
 * `portable`      · the same in any brand. A chosen director, a typed line.
 * `brand_owned`   · carried, but re-read from the target brand's record.
 * `brand_material`· made OF the brand. Never crosses; regenerate instead.
 *
 * A map rather than a chain of ifs, because the interesting property is that
 * you can read the whole policy in six lines and see what a new slot defaults
 * to.
 *
 * THE DEFAULT IS `brand_material`, and that is a deliberate choice about which
 * mistake to make. A future slot nobody thought to classify will be dropped on
 * a cross-brand replay and NAMED in the notes. The other default would carry
 * unknown brand-specific content silently into the wrong brand, which is the
 * failure nobody would notice until it published.
 */
export const SLOT_CLASSES: Record<string, "portable" | "brand_owned" | "brand_material"> = {
  brief: "brand_owned",
  direction: "portable",
  selected: "brand_material",
  copy: "brand_owned",
  crops: "brand_material",
};

export function slotClass(slotKey: string): "portable" | "brand_owned" | "brand_material" {
  return SLOT_CLASSES[slotKey] ?? "brand_material";
}

// ── Capture ──────────────────────────────────────────────────────────────────

export interface CapturedTake {
  slotKey: string;
  origin: TakeOrigin;
  payload: unknown;
  isCurrent: boolean;
}

export interface CaptureStage {
  stageNumber: number;
  stageKind: StageKind;
  /** The spine's own id, so consumedFrom can be resolved to stage kinds. */
  id: string;
  status: string;
  consumedFrom: string[];
  takes: CapturedTake[];
}

export interface CaptureResult {
  snapshot: RunSnapshot;
  /** The stage numbers that will replay. */
  lockedStages: number[];
  /** Reasons this cannot be saved. Empty means it can. */
  problems: string[];
}

/**
 * Take a run off a creative's spine.
 *
 * Two rules, both from doc 22's one-line definition of a saved run:
 *
 *   the BRIEF always travels, because it is the idea, and
 *   a later stage travels only if it was LOCKED, because locking is how
 *   somebody said "this part is decided" (Principle 1.4).
 *
 * Only CURRENT takes are captured. The take history belongs to the creative it
 * happened on: replaying somebody's eleven rejected attempts would be replaying
 * the mess rather than the decision.
 */
export function captureSnapshot(stages: CaptureStage[], sourceBrandId: string | null): CaptureResult {
  const kindById = new Map(stages.map((s) => [s.id, s.stageKind]));
  const captured: SavedRunStage[] = [];
  const problems: string[] = [];

  const ordered = [...stages].sort((a, b) => a.stageNumber - b.stageNumber);

  for (const stage of ordered) {
    const current = stage.takes.filter((t) => t.isCurrent);
    const isBrief = stage.stageNumber === 1;
    const isLocked = stage.status === "locked";
    if (!isBrief && !isLocked) continue;
    if (current.length === 0) continue;

    captured.push({
      stageNumber: stage.stageNumber,
      stageKind: stage.stageKind,
      locked: isLocked,
      slots: current.map((t) => ({ slotKey: t.slotKey, origin: t.origin, payload: t.payload })),
      // Stored as kinds, not ids: the ids are this creative's and mean nothing
      // in the spine a replay creates. Kinds are stable across every creative.
      consumedFromKinds: stage.consumedFrom
        .map((id) => kindById.get(id))
        .filter((k): k is StageKind => Boolean(k)),
    });
  }

  if (!captured.some((s) => s.stageNumber === 1)) {
    problems.push("The brief has nothing in it yet, so there is nothing to replay.");
  }

  return {
    snapshot: { version: RUN_SNAPSHOT_VERSION, sourceBrandId, stages: captured },
    lockedStages: captured.map((s) => s.stageNumber),
    problems,
  };
}

// ── Replay ───────────────────────────────────────────────────────────────────

export interface ReplayTarget {
  brandId: string;
  brandName: string;
  /** Platforms this brand has a connected account for. Drives the Channels row. */
  connectedPlatforms: string[];
  constraints: BrandConstraints;
}

export interface PlannedSlot {
  slotKey: string;
  origin: TakeOrigin;
  payload: unknown;
}

export interface PlannedStage {
  stageNumber: number;
  stageKind: StageKind;
  /** Replayed locked if it was locked when it was saved. */
  lock: boolean;
  consumedFromKinds: StageKind[];
  slots: PlannedSlot[];
}

export interface ReplayNote {
  kind: "rederived" | "dropped" | "carried" | "voice";
  slotKey: string;
  text: string;
}

export interface ReplayPlan {
  brandId: string;
  crossBrand: boolean;
  stages: PlannedStage[];
  /** What the replay did and did not carry, in the user's words. */
  notes: ReplayNote[];
}

/** Rows the brand record owns, and which are therefore never carried. */
const BRAND_OWNED_BRIEF_KEYS = new Set(["channels", "mustnot"]);

interface BriefPayload {
  line?: unknown;
  derived?: unknown;
  answers?: unknown;
}

/**
 * Re-read the brand-owned lines of a brief against the brand it is landing in.
 *
 * Done for EVERY replay, not only cross-brand ones. A snapshot of a brand
 * record is stale the moment it is taken: connect a TikTok account and last
 * month's saved run should not still be telling you the brand cannot publish
 * there. The live record is the only honest source, so the carried rows are
 * dropped and rebuilt rather than trusted.
 *
 * The typed line and the interview answers are the human's own words and are
 * never touched, per Principle 1.12 and the brief's own rule 2.
 */
export function rebaseBriefPayload(payload: unknown, target: ReplayTarget): { payload: unknown; rederived: string[] } {
  if (!payload || typeof payload !== "object") return { payload, rederived: [] };
  const p = payload as BriefPayload;

  const kept: DerivedRow[] = Array.isArray(p.derived)
    ? (p.derived as DerivedRow[]).filter(
        (row) => row && typeof row === "object" && !BRAND_OWNED_BRIEF_KEYS.has(row.key) && row.provenance !== "brand",
      )
    : [];

  const fresh: DerivedRow[] = [deriveChannels(target.connectedPlatforms)];
  const mustNot = deriveMustNot(target.constraints);
  if (mustNot) fresh.push(mustNot);

  return {
    payload: { ...p, derived: [...kept, ...fresh] },
    rederived: fresh.map((r) => r.label),
  };
}

interface CopyPayload {
  hook?: unknown;
  base?: unknown;
}

/** Every string in a copy payload that a human would read as the post's words. */
function copyText(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as CopyPayload;
  return [p.hook, p.base].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Turn a snapshot into the takes to write for one brand.
 *
 * The brand-crossing rules, and why each is what it is:
 *
 *   DIRECTOR CARRIES. A persona is account-scoped, and "house" resolves to
 *   whichever brand is asking. That is Principle 1.10 working as designed: one
 *   director across four brands without homogenising them.
 *
 *   PICTURES DO NOT CARRY. An image made under Crown U's contract is made of
 *   Crown U. The Image stage lands empty so the target brand's own contract
 *   makes its own, which is the entire point of "N sets of outputs".
 *
 *   COPY CARRIES, WITH A WARNING. Locked copy is somebody's own words and
 *   §2.4 says keep the human's work safe, so it travels. But it was written in
 *   another brand's voice, so it is checked against the target's banned terms
 *   and the finding is returned rather than being applied. Principle 1.13: a
 *   constraint on the model, a note to the human.
 */
export function planReplay(snapshot: RunSnapshot, target: ReplayTarget): ReplayPlan {
  const crossBrand = snapshot.sourceBrandId !== null && snapshot.sourceBrandId !== target.brandId;
  const notes: ReplayNote[] = [];
  const stages: PlannedStage[] = [];
  const droppedKinds = new Set<StageKind>();

  const ordered = [...(snapshot.stages ?? [])].sort((a, b) => a.stageNumber - b.stageNumber);

  for (const stage of ordered) {
    const slots: PlannedSlot[] = [];

    for (const slot of stage.slots ?? []) {
      const cls = slotClass(slot.slotKey);

      if (cls === "brand_material" && crossBrand) {
        notes.push({
          kind: "dropped",
          slotKey: slot.slotKey,
          text: `${describeSlot(slot.slotKey)} was made under a different brand, so it was not carried into ${target.brandName}. Make it here instead.`,
        });
        continue;
      }

      if (slot.slotKey === "brief") {
        const { payload, rederived } = rebaseBriefPayload(slot.payload, target);
        if (rederived.length > 0) {
          notes.push({
            kind: "rederived",
            slotKey: slot.slotKey,
            text: `${rederived.join(" and ")} came from ${target.brandName}'s own record, not from the saved run.`,
          });
        }
        slots.push({ slotKey: slot.slotKey, origin: slot.origin, payload });
        continue;
      }

      if (slot.slotKey === "copy" && crossBrand) {
        notes.push({
          kind: "carried",
          slotKey: slot.slotKey,
          text: `The copy was written for another brand and carried over as it is. Read it against ${target.brandName}'s voice before approving.`,
        });
        const banned = target.constraints.bannedTerms ?? [];
        for (const text of copyText(slot.payload)) {
          for (const note of voiceCheck(text, banned)) {
            if (note.kind === "banned_term") {
              notes.push({ kind: "voice", slotKey: slot.slotKey, text: note.message });
            }
          }
        }
      }

      slots.push({ slotKey: slot.slotKey, origin: slot.origin, payload: slot.payload });
    }

    if (slots.length === 0) {
      droppedKinds.add(stage.stageKind);
      continue;
    }

    stages.push({
      stageNumber: stage.stageNumber,
      stageKind: stage.stageKind,
      lock: stage.locked,
      // An edge to a stage that did not replay is not an edge. Keeping it would
      // leave the new spine claiming a dependency on an empty stage, and
      // staleness walks exactly this list.
      consumedFromKinds: (stage.consumedFromKinds ?? []).filter((k) => !droppedKinds.has(k)),
      slots,
    });
  }

  return { brandId: target.brandId, crossBrand, stages, notes };
}

/** Human names for the slots, used only in notes the user reads. */
function describeSlot(slotKey: string): string {
  switch (slotKey) {
    case "selected": return "The chosen image";
    case "crops": return "The channel crops";
    case "copy": return "The copy";
    case "direction": return "The director";
    case "brief": return "The brief";
    default: return `The ${slotKey}`;
  }
}

/**
 * Whether a snapshot can be replayed at all by this build.
 *
 * A version check that returns a reason rather than throwing, so a run saved by
 * a later build reads as "this run was saved by a newer version" in the list
 * instead of crashing the page that lists it.
 */
export function replayability(snapshot: RunSnapshot): { ok: boolean; reason?: string } {
  if (!snapshot || typeof snapshot !== "object") return { ok: false, reason: "This run has no saved stages." };
  if (snapshot.version > RUN_SNAPSHOT_VERSION) {
    return { ok: false, reason: "This run was saved by a newer version of the Studio." };
  }
  if (!Array.isArray(snapshot.stages) || snapshot.stages.length === 0) {
    return { ok: false, reason: "This run has no saved stages." };
  }
  return { ok: true };
}
