/**
 * The bridge from the spine to the thing that publishes.
 *
 * WHAT WAS BROKEN. Studio v2 wrote `stage_takes` and nothing else, and no code
 * in the publish path has ever read a stage take. A post could be walked
 * through all five stages, locked and approved, while the `creative_variants`
 * row the scheduler sends stayed exactly as it was. Everything built on the
 * spine — the spread, the copy, the crops, saved runs, cross-brand fan-out —
 * produced work that could not go out.
 *
 * This is the one place that turns a decided spine into variants. Two
 * endpoints, and the split is deliberate:
 *
 *   GET  ship-preview  · free, changes nothing, says exactly what would be
 *                        written per channel and what is falling back to a
 *                        default. Doc 24 §8: show the consequence before the act.
 *   POST ship          · does it, in one transaction.
 *
 * Every decision about WHAT to write lives in services/ship.ts, pure and with
 * 39 assertions behind it. This file reads rows, hands plain objects to that
 * module, and writes back what it decided.
 *
 * IT DOES NOT SCHEDULE. Scheduling lives in the Pipeline and already works;
 * duplicating it here would give the product a second scheduler to keep in
 * agreement with the first. Shipping makes the post schedulable and hands off.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  approvalsTable,
  calendarEntriesTable,
  creativeVariantsTable,
  creativesTable,
  socialAccountsTable,
  stageStatesTable,
  stageTakesTable,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { recordAudit, actorFromRequest } from "../lib/audit.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { resolveChannels, type Channel } from "../services/channels.js";
import {
  planShip,
  shippingBlockedBySchedule,
  type ShipCopy,
  type ShipCrops,
  type ShipImage,
  type ShipPlan,
} from "../services/ship.js";

const router: IRouter = Router();

function userId(req: Request): string | null {
  return (req as { user?: { id?: string } }).user?.id ?? null;
}

interface Loaded {
  creative: { id: string; brandId: string; status: string };
  channels: Channel[];
  image: ShipImage | null;
  copy: ShipCopy | null;
  crops: ShipCrops | null;
  existingVariants: Array<{ id: string; platform: string }>;
  entries: Array<{ platform: string; publishStatus: string }>;
}

/** The current take of one slot, or null. Only current takes are shippable. */
function currentPayload(
  takes: Array<{ stageStateId: string; slotKey: string; isCurrent: boolean; payload: unknown }>,
  stageId: string | undefined,
  slotKey: string,
): unknown {
  if (!stageId) return null;
  const take = takes.find((t) => t.stageStateId === stageId && t.slotKey === slotKey && t.isCurrent);
  return take?.payload ?? null;
}

async function load(creativeId: string): Promise<Loaded | null> {
  const [creative] = await db
    .select({ id: creativesTable.id, brandId: creativesTable.brandId, status: creativesTable.status })
    .from(creativesTable)
    .where(eq(creativesTable.id, creativeId));
  if (!creative) return null;

  // Workspace-wide, not brand-scoped: every brand currently publishes through
  // the Sparq Games accounts, and the brand id only decides each channel's
  // DEFAULT account. See services/channels.ts.
  const accounts = await db
    .select({
      id: socialAccountsTable.id,
      platform: socialAccountsTable.platform,
      accountName: socialAccountsTable.accountName,
      brandId: socialAccountsTable.brandId,
    })
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.status, "connected"));

  const stages = await db
    .select({ id: stageStatesTable.id, stageKind: stageStatesTable.stageKind })
    .from(stageStatesTable)
    .where(eq(stageStatesTable.creativeId, creativeId));

  const takes = stages.length
    ? await db
        .select({
          stageStateId: stageTakesTable.stageStateId,
          slotKey: stageTakesTable.slotKey,
          isCurrent: stageTakesTable.isCurrent,
          payload: stageTakesTable.payload,
        })
        .from(stageTakesTable)
        .where(inArray(stageTakesTable.stageStateId, stages.map((s) => s.id)))
    : [];

  const idOf = (kind: string) => stages.find((s) => s.stageKind === kind)?.id;

  const imagePayload = currentPayload(takes, idOf("asset"), "selected") as { imageUrl?: unknown } | null;
  const copyPayload = currentPayload(takes, idOf("copy"), "copy") as ShipCopy | null;
  const cropsPayload = currentPayload(takes, idOf("crops"), "crops") as { focal?: unknown } | null;
  /*
   * Stage 03's motion take, if one exists. Carried onto every channel version
   * ONLY when it was animated from the still being shipped: a clip made from
   * an earlier pick is a different picture wearing the same post, and shipping
   * it silently is the lineage failure the Motion panel exists to name.
   */
  const motionPayload = currentPayload(takes, idOf("asset"), "motion") as
    | { videoUrl?: unknown; sourceImageUrl?: unknown }
    | null;

  const existingVariants = await db
    .select({
      id: creativeVariantsTable.id,
      platform: creativeVariantsTable.platform,
      // The content columns shipping writes, so the preview can say whether a
      // re-ship would CHANGE anything. "A row exists" alone read as "Ready to
      // update" forever after a reload, and the schedule handoff only survived
      // inside the client session that pressed Ship (doc 40 P1.9).
      caption: creativeVariantsTable.caption,
      hookText: creativeVariantsTable.hookText,
      compositedImageUrl: creativeVariantsTable.compositedImageUrl,
      videoUrl: creativeVariantsTable.videoUrl,
      focalX: creativeVariantsTable.focalX,
      focalY: creativeVariantsTable.focalY,
    })
    .from(creativeVariantsTable)
    .where(eq(creativeVariantsTable.creativeId, creativeId));

  const entries = await db
    .select({ platform: calendarEntriesTable.platform, publishStatus: calendarEntriesTable.publishStatus })
    .from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.creativeId, creativeId));

  const focal = (cropsPayload?.focal ?? null) as ShipCrops["focal"] | null;

  const stillUrl = typeof imagePayload?.imageUrl === "string" ? imagePayload.imageUrl : null;
  const motionUrl = typeof motionPayload?.videoUrl === "string" ? motionPayload.videoUrl : null;
  const motionSource = typeof motionPayload?.sourceImageUrl === "string" ? motionPayload.sourceImageUrl : null;

  return {
    creative,
    channels: resolveChannels(accounts, creative.brandId),
    image: stillUrl ? { imageUrl: stillUrl } : null,
    copy: copyPayload && typeof copyPayload === "object" ? copyPayload : null,
    crops: focal && typeof focal.x === "number" && typeof focal.y === "number" ? { focal } : null,
    /** The clip that ships with the still, or the reason one did not. */
    motion: motionUrl
      ? motionSource === stillUrl
        ? { videoUrl: motionUrl, stale: false as const }
        : { videoUrl: motionUrl, stale: true as const }
      : null,
    existingVariants,
    entries,
  };
}

function shape(
  plan: ShipPlan,
  scheduleBlock: string | null,
  existing: Array<{
    id: string;
    platform: string;
    caption: string | null;
    hookText: string | null;
    compositedImageUrl: string | null;
    videoUrl: string | null;
    focalX: number | null;
    focalY: number | null;
  }> = [],
  motion: { videoUrl: string; stale: boolean } | null = null,
) {
  const byPlatform = new Map(existing.map((e) => [e.platform, e]));
  const shipVideoUrl = motion && !motion.stale ? motion.videoUrl : null;
  /** Would re-shipping this channel change what is already written? */
  const changed = (v: ShipPlan["variants"][number]): boolean => {
    const e = byPlatform.get(v.platform);
    if (!e) return true;
    return (
      e.caption !== v.caption ||
      (e.hookText ?? null) !== (v.hookText ?? null) ||
      e.compositedImageUrl !== v.imageUrl ||
      (e.videoUrl ?? null) !== shipVideoUrl ||
      e.focalX !== v.focalX ||
      e.focalY !== v.focalY
    );
  };
  // Said before anything is pressed, both ways: the clip that will ride
  // along, and the clip that will be left behind because the pick moved on.
  const warnings = [...plan.warnings];
  if (motion && !motion.stale) {
    warnings.push("A motion clip ships with every channel version, animated from this still.");
  } else if (motion?.stale) {
    warnings.push("A clip exists but was animated from an earlier pick, so it will not ship. Animate the current pick on the Motion tab to carry it.");
  }
  const variants = plan.variants.map((v) => ({
    platform: v.platform,
    label: v.label,
    accountName: v.accountName,
    aspectRatio: v.aspectRatio,
    caption: v.caption,
    hookText: v.hookText,
    updates: v.existingId !== null,
    changed: changed(v),
  }));
  return {
    // The schedule block is a block like any other, so a caller never has to
    // check two different places to learn whether shipping is possible.
    blocked: scheduleBlock ? [scheduleBlock, ...plan.blocked] : plan.blocked,
    warnings,
    variants,
    /*
     * True when what is shipped IS what the stages currently say. The old
     * signal ("a variant row exists") read as "Ready to update" forever, so a
     * shipped post lost its schedule handoff on the first reload (doc 40
     * P1.9). The client shows the exit when nothing would change.
     */
    inSync: plan.blocked.length === 0 && variants.length > 0 && variants.every((v) => v.updates && !v.changed),
  };
}

/** What shipping would write. Free, and changes nothing. */
router.get("/creatives/:creativeId/ship-preview", async (req: Request, res: Response): Promise<void> => {
  const creativeId = str(req.params.creativeId);
  try {
    const loaded = await load(creativeId);
    if (!loaded) {
      res.status(404).json({ error: "That post no longer exists." });
      return;
    }
    const plan = planShip(loaded);
    res.json(shape(plan, shippingBlockedBySchedule(loaded.entries), loaded.existingVariants, loaded.motion));
  } catch (err) {
    console.error("Failed to preview shipping", err);
    res.status(500).json({ error: "What this would publish could not be worked out." });
  }
});

router.post(
  "/creatives/:creativeId/ship",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = str(req.params.creativeId);
    const me = userId(req);

    try {
      const loaded = await load(creativeId);
      if (!loaded) {
        res.status(404).json({ error: "That post no longer exists." });
        return;
      }

      const scheduleBlock = shippingBlockedBySchedule(loaded.entries);
      if (scheduleBlock) {
        res.status(409).json({ error: scheduleBlock });
        return;
      }

      const plan = planShip(loaded);
      if (plan.blocked.length > 0) {
        res.status(400).json({ error: plan.blocked[0], blocked: plan.blocked });
        return;
      }

      /**
       * An approval covers the content that existed when it was given.
       *
       * Walking a post through the stages again and re-shipping replaces the
       * picture, the words and the framing under a decision somebody already
       * made. Leaving that decision standing is the same defect as a scheduled
       * entry being rewritten underneath, only quieter. So the previous
       * decision stays in the record, untouched, and a FRESH request is opened
       * on top of it: the team surface then reads "awaiting" for the reason it
       * actually is.
       */
      const decided = await db
        .select({ id: approvalsTable.id, decision: approvalsTable.decision })
        .from(approvalsTable)
        .where(eq(approvalsTable.creativeId, creativeId));
      const wasApproved = decided.some((a) => a.decision === "approved");

      const written = await db.transaction(async (tx) => {
        const out: Array<{ id: string; platform: string; updated: boolean }> = [];

        // Attached only when the clip is THIS still in motion (load() checked
        // the lineage). A stale clip stays a take on stage 03 and the preview
        // says why it was left behind.
        const shipMotion = loaded.motion && !loaded.motion.stale ? loaded.motion.videoUrl : null;

        for (const v of plan.variants) {
          const common = {
            platform: v.platform,
            aspectRatio: v.aspectRatio,
            caption: v.caption,
            // The picture the spread produced IS the composited image: the
            // spread renders finished frames, so there is no separate
            // compositing step for the publisher to wait on.
            compositedImageUrl: v.imageUrl,
            rawImageUrl: v.imageUrl,
            hookText: v.hookText,
            // Doc 24 §7 prefers the overlay path: deterministic, editable
            // afterwards, and free, where rendered typography costs a model
            // call and an OCR check.
            hookRenderMode: v.hookText ? "overlay" : null,
            focalX: v.focalX,
            focalY: v.focalY,
            videoUrl: shipMotion,
            mediumType: shipMotion ? "motion" : "image",
            status: "generated",
            updatedAt: new Date(),
          };

          if (v.existingId) {
            await tx.update(creativeVariantsTable).set(common).where(eq(creativeVariantsTable.id, v.existingId));
            out.push({ id: v.existingId, platform: v.platform, updated: true });
          } else {
            const [row] = await tx
              .insert(creativeVariantsTable)
              .values({ creativeId, ...common })
              .returning({ id: creativeVariantsTable.id });
            out.push({ id: row!.id, platform: v.platform, updated: false });
          }
        }

        if (wasApproved) {
          await tx
            .update(creativesTable)
            .set({ status: "draft", updatedAt: new Date() })
            .where(eq(creativesTable.id, creativeId));
          // requestedBy is NOT NULL, so an unauthenticated caller cannot open a
          // request. The status reset still happens, and the response says so,
          // rather than silently leaving the post looking approved.
          if (me) {
            await tx.insert(approvalsTable).values({ creativeId, requestedBy: me });
          }
        }

        return out;
      });

      await recordAudit({
        actor: actorFromRequest(req),
        action: "creative.shipped",
        entityType: "creative",
        entityIds: [creativeId],
        metadata: { variantIds: written.map((w) => w.id), channels: written.map((w) => w.platform) },
      });

      res.status(201).json({
        variants: written,
        warnings: plan.warnings,
        approvalReset: wasApproved,
        approvalRequested: wasApproved && Boolean(me),
      });
    } catch (err) {
      console.error("Failed to ship", err);
      res.status(500).json({ error: "This post could not be made ready to publish." });
    }
  },
);

export default router;
