/**
 * Saved-run capture and replay cases, shared by the vitest suite and the tsx
 * runner, following the pattern set by brief-intake.cases.ts.
 *
 * The invariants worth protecting are the brand-boundary ones. Everything else
 * here is bookkeeping; the cases that matter are the ones asserting that a
 * picture does not cross a brand, that a "must not" is re-read rather than
 * carried, and that a dependency edge to a stage that did not replay is gone
 * rather than dangling.
 */

import {
  captureSnapshot,
  planReplay,
  rebaseBriefPayload,
  replayability,
  slotClass,
  type CaptureStage,
  type ReplayTarget,
} from "./saved-runs.js";
import type { RunSnapshot } from "@workspace/db/schema";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const CROWN = "brand-crown";
const RUMBLE = "brand-rumble";

const crownTarget: ReplayTarget = {
  brandId: CROWN,
  brandName: "Crown U",
  connectedPlatforms: ["instagram", "twitter"],
  constraints: { bannedTerms: ["dynasty"], negativePrompt: "no stock photography", trademarkRules: null },
};

const rumbleTarget: ReplayTarget = {
  brandId: RUMBLE,
  brandName: "Rumble U",
  connectedPlatforms: ["tiktok"],
  constraints: { bannedTerms: ["esports"], negativePrompt: null, trademarkRules: null },
};

/** A spine as the capture endpoint reads it. */
function spine(over: Partial<Record<string, unknown>> = {}): CaptureStage[] {
  const base: CaptureStage[] = [
    {
      id: "s1", stageNumber: 1, stageKind: "brief", status: "locked", consumedFrom: [],
      takes: [{
        slotKey: "brief", origin: "user_typed", isCurrent: true,
        payload: {
          line: "rivalry week hype",
          answers: [{ id: "timing", value: "live now" }],
          derived: [
            { key: "goal", label: "Goal", value: "Community engagement", provenance: "inferred" },
            { key: "channels", label: "Channels", value: "IG, X", provenance: "brand" },
            { key: "mustnot", label: "Must not", value: "never say dynasty", provenance: "brand" },
          ],
        },
      }],
    },
    {
      id: "s2", stageNumber: 2, stageKind: "direction", status: "locked", consumedFrom: ["s1"],
      takes: [{ slotKey: "direction", origin: "swapped_in", isCurrent: true, payload: { directorId: "persona-ava", kind: "persona", name: "Ava K" } }],
    },
    {
      id: "s3", stageNumber: 3, stageKind: "asset", status: "locked", consumedFrom: ["s1", "s2"],
      takes: [
        { slotKey: "selected", origin: "generated", isCurrent: true, payload: { variantId: "v9", imageUrl: "/api/files/x.png" } },
        { slotKey: "selected", origin: "generated", isCurrent: false, payload: { variantId: "v8" } },
      ],
    },
    {
      id: "s4", stageNumber: 4, stageKind: "copy", status: "locked", consumedFrom: ["s3"],
      takes: [{ slotKey: "copy", origin: "user_typed", isCurrent: true, payload: { hook: "Dynasty week", base: "The rivalry that made the league.", channels: {} } }],
    },
    {
      id: "s5", stageNumber: 5, stageKind: "crops", status: "locked", consumedFrom: ["s3"],
      takes: [{ slotKey: "crops", origin: "generated", isCurrent: true, payload: { instagram: { focalX: 0.5 } } }],
    },
  ];
  return base.map((s) => ({ ...s, ...((over[s.id] as object) ?? {}) }));
}

export function collectSavedRunCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------- slot policy
  check("the brief is brand-owned", slotClass("brief") === "brand_owned");
  check("the director is portable", slotClass("direction") === "portable");
  check("the chosen image is brand material", slotClass("selected") === "brand_material");
  check("the crops are brand material", slotClass("crops") === "brand_material");
  check(
    "a slot nobody classified defaults to brand material, so it cannot cross silently",
    slotClass("hashtags") === "brand_material" && slotClass("motion") === "brand_material",
  );

  // ----------------------------------------------------------------- capture
  {
    const out = captureSnapshot(spine(), CROWN);
    check("a fully locked spine captures all five stages", out.snapshot.stages.length === 5, out.lockedStages);
    check("capture records the brand it came from", out.snapshot.sourceBrandId === CROWN);
    check("capture reports no problems when the brief has content", out.problems.length === 0, out.problems);
    const s3 = out.snapshot.stages.find((s) => s.stageNumber === 3);
    check("only the current take is captured", (s3?.slots.length ?? 0) === 1, s3?.slots);
    check(
      "consumedFrom is stored as stage kinds, not this creative's ids",
      JSON.stringify(s3?.consumedFromKinds) === JSON.stringify(["brief", "direction"]),
      s3?.consumedFromKinds,
    );
  }

  {
    // Doc 22's definition: the brief always travels, later stages only if locked.
    const unlockedLater = spine({
      s2: { status: "done" },
      s3: { status: "done" },
      s4: { status: "done" },
      s5: { status: "done" },
    });
    const out = captureSnapshot(unlockedLater, CROWN);
    check(
      "an unlocked later stage does not travel",
      out.lockedStages.join(",") === "1",
      out.lockedStages,
    );
    check("the brief travels even though nothing else did", out.snapshot.stages[0]?.stageKind === "brief");
  }

  {
    const noBrief = spine().map((s) => (s.id === "s1" ? { ...s, takes: [] } : s));
    const out = captureSnapshot(noBrief, CROWN);
    check("a spine with an empty brief refuses to be saved", out.problems.length === 1, out.problems);
  }

  {
    const briefUnlocked = spine({ s1: { status: "active" } });
    const out = captureSnapshot(briefUnlocked, CROWN);
    const brief = out.snapshot.stages.find((s) => s.stageNumber === 1);
    check("an unlocked brief still travels, but is not marked locked", brief !== undefined && brief.locked === false, brief?.locked);
  }

  // ---------------------------------------------------- replay, same brand
  {
    const snap = captureSnapshot(spine(), CROWN).snapshot;
    const plan = planReplay(snap, crownTarget);
    check("replaying into its own brand is not cross-brand", plan.crossBrand === false);
    check("replaying into its own brand keeps the picture", plan.stages.some((s) => s.stageKind === "asset"), plan.stages.map((s) => s.stageKind));
    check("replaying into its own brand keeps the crops", plan.stages.some((s) => s.stageKind === "crops"));
    check("a locked stage replays locked", plan.stages.find((s) => s.stageKind === "direction")?.lock === true);
  }

  {
    // The one stage that can travel unlocked is the brief, because it travels
    // by being the idea rather than by being decided.
    const snap = captureSnapshot(spine({ s1: { status: "active" } }), CROWN).snapshot;
    const plan = planReplay(snap, crownTarget);
    check(
      "an unlocked brief replays unlocked, so it can still be edited",
      plan.stages.find((s) => s.stageKind === "brief")?.lock === false,
      plan.stages.find((s) => s.stageKind === "brief")?.lock,
    );
    check(
      "brand rows are re-read even for the brand it came from, because a record moves",
      plan.notes.some((n) => n.kind === "rederived"),
      plan.notes,
    );
  }

  // --------------------------------------------------- replay, cross-brand
  {
    const snap = captureSnapshot(spine(), CROWN).snapshot;
    const plan = planReplay(snap, rumbleTarget);
    check("replaying into another brand is cross-brand", plan.crossBrand === true);

    const kinds = plan.stages.map((s) => s.stageKind);
    check("the picture does not cross a brand boundary", !kinds.includes("asset"), kinds);
    check("the crops do not cross a brand boundary", !kinds.includes("crops"), kinds);
    check("the brief crosses", kinds.includes("brief"));
    check("the director crosses", kinds.includes("direction"));
    check("the copy crosses", kinds.includes("copy"));

    check(
      "the dropped picture is named rather than silently missing",
      plan.notes.some((n) => n.kind === "dropped" && n.slotKey === "selected"),
      plan.notes,
    );
    check(
      "carried copy is flagged as written for another brand",
      plan.notes.some((n) => n.kind === "carried" && n.slotKey === "copy"),
    );

    const copyStage = plan.stages.find((s) => s.stageKind === "copy");
    check(
      "a dependency on a stage that did not replay is dropped, not left dangling",
      (copyStage?.consumedFromKinds.length ?? -1) === 0,
      copyStage?.consumedFromKinds,
    );

    const directionStage = plan.stages.find((s) => s.stageKind === "direction");
    check(
      "a dependency on a stage that DID replay survives",
      JSON.stringify(directionStage?.consumedFromKinds) === JSON.stringify(["brief"]),
      directionStage?.consumedFromKinds,
    );
  }

  {
    // The failure this whole file exists to prevent: one brand's rules binding
    // another brand's post.
    const snap = captureSnapshot(spine(), CROWN).snapshot;
    const plan = planReplay(snap, rumbleTarget);
    const brief = plan.stages.find((s) => s.stageKind === "brief");
    const derived = ((brief?.slots[0]?.payload as { derived?: Array<{ key: string; value: string }> })?.derived) ?? [];
    check(
      "Crown U's must-not does not follow the run into Rumble U",
      !derived.some((r) => r.value.includes("dynasty")),
      derived,
    );
    check(
      "the channels row names the TARGET brand's connected platform",
      derived.some((r) => r.key === "channels" && r.value.includes("TikTok")),
      derived,
    );
    check(
      "the goal row, which the line produced rather than the brand, survives",
      derived.some((r) => r.key === "goal"),
      derived,
    );
    const line = (brief?.slots[0]?.payload as { line?: string })?.line;
    check("the typed line is never rewritten", line === "rivalry week hype", line);
  }

  {
    // Copy carried into a brand that bans one of its words.
    const snap = captureSnapshot(spine(), CROWN).snapshot;
    const esportsTarget: ReplayTarget = {
      ...rumbleTarget,
      constraints: { bannedTerms: ["rivalry"], negativePrompt: null, trademarkRules: null },
    };
    const plan = planReplay(snap, esportsTarget);
    check(
      "carried copy is checked against the target brand's banned terms",
      plan.notes.some((n) => n.kind === "voice" && n.text.includes("rivalry")),
      plan.notes.filter((n) => n.kind === "voice"),
    );
    const copyStage = plan.stages.find((s) => s.stageKind === "copy");
    check(
      "the finding is a note, not an edit: the words are still the human's",
      (copyStage?.slots[0]?.payload as { base?: string })?.base === "The rivalry that made the league.",
    );
  }

  // ------------------------------------------------------------- rebasing
  {
    const { payload, rederived } = rebaseBriefPayload(
      { line: "x", derived: [{ key: "channels", label: "Channels", value: "IG", provenance: "brand" }] },
      { ...rumbleTarget, connectedPlatforms: [] },
    );
    const derived = (payload as { derived: Array<{ key: string; value: string }> }).derived;
    check(
      "a brand with no connected account says so rather than promising a channel",
      derived.some((r) => r.key === "channels" && r.value.includes("No channel is connected")),
      derived,
    );
    check("the rebase names what it re-read", rederived.includes("Channels"), rederived);
  }

  {
    const { payload } = rebaseBriefPayload(
      { derived: [{ key: "audience", label: "Audience", value: "Existing players", provenance: "inferred" }] },
      rumbleTarget,
    );
    const derived = (payload as { derived: Array<{ key: string }> }).derived;
    check("an inferred row is kept, because the line produced it", derived.some((r) => r.key === "audience"), derived);
  }

  {
    const out = rebaseBriefPayload("not an object", rumbleTarget);
    check("a malformed brief payload is returned untouched rather than throwing", out.payload === "not an object");
  }

  {
    const out = rebaseBriefPayload({ derived: "not an array" }, rumbleTarget);
    const derived = (out.payload as { derived: unknown[] }).derived;
    check("a non-array derived list does not crash the replay", Array.isArray(derived), derived);
  }

  // --------------------------------------------------------- replayability
  {
    check("a current snapshot is replayable", replayability({ version: 1, sourceBrandId: CROWN, stages: [{ stageNumber: 1, stageKind: "brief", locked: true, slots: [], consumedFromKinds: [] }] }).ok);
    const future = replayability({ version: 99, sourceBrandId: null, stages: [] } as RunSnapshot);
    check("a run saved by a newer build says so instead of crashing", future.ok === false && Boolean(future.reason), future);
    const empty = replayability({ version: 1, sourceBrandId: null, stages: [] });
    check("a snapshot with no stages is not replayable", empty.ok === false, empty);
  }

  {
    // A snapshot whose only stage is the picture: cross-brand, everything drops.
    const snap: RunSnapshot = {
      version: 1,
      sourceBrandId: CROWN,
      stages: [{ stageNumber: 3, stageKind: "asset", locked: true, slots: [{ slotKey: "selected", origin: "generated", payload: {} }], consumedFromKinds: [] }],
    };
    const plan = planReplay(snap, rumbleTarget);
    check("a stage left with no slots is not written as an empty stage", plan.stages.length === 0, plan.stages);
    check("and the drop is still explained", plan.notes.length === 1, plan.notes);
  }

  return cases;
}
