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

  const existingVariants = await db
    .select({ id: creativeVariantsTable.id, platform: creativeVariantsTable.platform })
    .from(creativeVariantsTable)
    .where(eq(creativeVariantsTable.creativeId, creativeId));

  const entries = await db
    .select({ platform: calendarEntriesTable.platform, publishStatus: calendarEntriesTable.publishStatus })
    .from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.creativeId, creativeId));

  const focal = (cropsPayload?.focal ?? null) as ShipCrops["focal"] | null;

  return {
    creative,
    channels: resolveChannels(accounts, creative.brandId),
    image: typeof imagePayload?.imageUrl === "string" ? { imageUrl: imagePayload.imageUrl } : null,
    copy: copyPayload && typeof copyPayload === "object" ? copyPayload : null,
    crops: focal && typeof focal.x === "number" && typeof focal.y === "number" ? { focal } : null,
    existingVariants,
    entries,
  };
}

function shape(plan: ShipPlan, scheduleBlock: string | null) {
  return {
    // The schedule block is a block like any other, so a caller never has to
    // check two different places to learn whether shipping is possible.
    blocked: scheduleBlock ? [scheduleBlock, ...plan.blocked] : plan.blocked,
    warnings: plan.warnings,
    variants: plan.variants.map((v) => ({
      platform: v.platform,
      label: v.label,
      accountName: v.accountName,
      aspectRatio: v.aspectRatio,
      caption: v.caption,
      hookText: v.hookText,
      updates: v.existingId !== null,
    })),
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
    res.json(shape(plan, shippingBlockedBySchedule(loaded.entries)));
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
            mediumType: "image",
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
