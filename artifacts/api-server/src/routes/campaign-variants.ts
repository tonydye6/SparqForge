import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db, campaignVariantsTable, campaignsTable, refinementLogsTable, assetPairingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/campaigns/:campaignId/variants", async (req, res): Promise<void> => {
  const { campaignId } = req.params;
  try {
    const variants = await db
      .select()
      .from(campaignVariantsTable)
      .where(eq(campaignVariantsTable.campaignId, campaignId as string))
      .orderBy(campaignVariantsTable.platform);

    res.json(variants);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch variants" });
  }
});

router.post("/campaigns/:campaignId/variants", async (req, res): Promise<void> => {
  const { campaignId } = req.params;
  const { platform, aspectRatio, caption, headlineText } = req.body;

  if (!platform || !aspectRatio) {
    res.status(400).json({ error: "Missing required fields: platform, aspectRatio" });
    return;
  }

  try {
    const [variant] = await db.insert(campaignVariantsTable).values({
      campaignId: campaignId as string,
      platform,
      aspectRatio,
      caption: caption || "",
      originalCaption: caption || "",
      headlineText: headlineText || null,
      originalHeadline: headlineText || null,
    }).returning();

    res.status(201).json(variant);
  } catch (err) {
    res.status(500).json({ error: "Failed to create variant" });
  }
});

router.put("/campaigns/:campaignId/variants/:variantId", async (req, res): Promise<void> => {
  const { campaignId, variantId } = req.params;

  try {
    const [existingVariant] = await db.select().from(campaignVariantsTable)
      .where(and(
        eq(campaignVariantsTable.id, variantId as string),
        eq(campaignVariantsTable.campaignId, campaignId as string),
      ));

    if (!existingVariant) {
      res.status(404).json({ error: "Variant not found for this campaign" });
      return;
    }

    const newStatus = req.body.status;
    if (newStatus === "rejected" && (!req.body.reviewerComment || !req.body.reviewerComment.trim())) {
      res.status(400).json({ error: "Rejection requires a reviewer comment" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.caption !== undefined) updates.caption = req.body.caption;
    if (req.body.headlineText !== undefined) updates.headlineText = req.body.headlineText;
    if (newStatus !== undefined) updates.status = newStatus;
    if (req.body.rawImageUrl !== undefined) updates.rawImageUrl = req.body.rawImageUrl;
    if (req.body.compositedImageUrl !== undefined) updates.compositedImageUrl = req.body.compositedImageUrl;

    updates.updatedAt = new Date();

    const [variant] = await db
      .update(campaignVariantsTable)
      .set(updates)
      .where(and(
        eq(campaignVariantsTable.id, variantId as string),
        eq(campaignVariantsTable.campaignId, campaignId as string),
      ))
      .returning();

    if (newStatus === "approved" || newStatus === "rejected") {
      const [camp] = await db.select({ templateId: campaignsTable.templateId }).from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId as string));
      if (camp?.templateId) {
        await db.insert(refinementLogsTable).values({
          campaignId: campaignId as string,
          templateId: camp.templateId,
          editType: newStatus === "approved" ? "approval" : "rejection",
          platform: existingVariant.platform,
          aspectRatio: existingVariant.aspectRatio,
          newValue: req.body.reviewerComment || null,
          userId: (req as any).user?.id || "system",
        });

        try {
          const pairings = await db.select().from(assetPairingsTable)
            .where(and(
              eq(assetPairingsTable.campaignId, campaignId as string),
              eq(assetPairingsTable.templateId, camp.templateId),
            ));

          for (const pairing of pairings) {
            if (pairing.finalStatus === "approved") continue;

            const updates: Record<string, unknown> = {
              updatedAt: new Date(),
            };

            if (pairing.firstPassApproved === null) {
              updates.firstPassApproved = newStatus === "approved";
            }

            if (newStatus === "approved") {
              updates.finalStatus = "approved";
            } else if (newStatus === "rejected") {
              updates.totalRefinements = sql`${assetPairingsTable.totalRefinements} + 1`;
              updates.finalStatus = "needs_refinement";
            }

            await db.update(assetPairingsTable)
              .set(updates)
              .where(eq(assetPairingsTable.id, pairing.id));
          }
        } catch (err) {
          console.error("Failed to update asset pairings:", err instanceof Error ? err.message : err);
        }
      }
    }

    res.json(variant);
  } catch (err) {
    res.status(500).json({ error: "Failed to update variant" });
  }
});

const bulkUpdateSchema = z.object({
  variantIds: z.array(z.string()).min(1),
  status: z.enum(["approved", "rejected"]),
  reviewerComment: z.string().optional(),
});

router.post("/campaigns/:campaignId/variants/bulk-update", async (req, res): Promise<void> => {
  const { campaignId } = req.params;

  // 1. Parse and validate request body
  const parseResult = bulkUpdateSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body", details: parseResult.error.issues });
    return;
  }

  const { variantIds, status, reviewerComment } = parseResult.data;

  // 2. Rejected status requires a reviewerComment
  if (status === "rejected" && (!reviewerComment || !reviewerComment.trim())) {
    res.status(400).json({ error: "Rejection requires a reviewer comment" });
    return;
  }

  try {
    // 3. Fetch all variants for this campaign and verify all requested IDs belong to it
    const campaignVariants = await db
      .select()
      .from(campaignVariantsTable)
      .where(eq(campaignVariantsTable.campaignId, campaignId as string));

    const campaignVariantIds = new Set(campaignVariants.map((v) => v.id));
    const invalidIds = variantIds.filter((id) => !campaignVariantIds.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: "Some variant IDs do not belong to this campaign", invalidIds });
      return;
    }

    // Fetch the campaign's templateId once (needed for refinement logs)
    const [camp] = await db
      .select({ templateId: campaignsTable.templateId })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId as string));

    // 4. Run updates in a transaction
    const updated = await db.transaction(async (tx) => {
      const results: { id: string; status: string }[] = [];

      for (const variantId of variantIds) {
        const variant = campaignVariants.find((v) => v.id === variantId)!;

        // 4a. Update variant status (and reviewerComment if rejecting)
        const variantUpdates: Record<string, unknown> = {
          status,
          updatedAt: new Date(),
        };

        const [updatedVariant] = await tx
          .update(campaignVariantsTable)
          .set(variantUpdates)
          .where(
            and(
              eq(campaignVariantsTable.id, variantId),
              eq(campaignVariantsTable.campaignId, campaignId as string),
            ),
          )
          .returning();

        results.push({ id: updatedVariant.id, status: updatedVariant.status });

        // 4b. Create a refinement log entry (matching the single-variant PUT handler pattern)
        if (camp?.templateId) {
          await tx.insert(refinementLogsTable).values({
            campaignId: campaignId as string,
            templateId: camp.templateId,
            editType: status === "approved" ? "approval" : "rejection",
            platform: variant.platform,
            aspectRatio: variant.aspectRatio,
            newValue: reviewerComment || null,
            userId: (req as any).user?.id || "system",
          });
        }
      }

      return results;
    });

    // 5. After transaction: check if ALL variants for this campaign are now "approved"
    const allVariantsAfterUpdate = await db
      .select({ status: campaignVariantsTable.status })
      .from(campaignVariantsTable)
      .where(eq(campaignVariantsTable.campaignId, campaignId as string));

    const allApproved = allVariantsAfterUpdate.length > 0 && allVariantsAfterUpdate.every((v) => v.status === "approved");

    let campaignStatus: string;
    if (allApproved) {
      const [updatedCampaign] = await db
        .update(campaignsTable)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(campaignsTable.id, campaignId as string))
        .returning({ status: campaignsTable.status });
      campaignStatus = updatedCampaign.status;
    } else {
      const [currentCampaign] = await db
        .select({ status: campaignsTable.status })
        .from(campaignsTable)
        .where(eq(campaignsTable.id, campaignId as string));
      campaignStatus = currentCampaign?.status ?? "unknown";
    }

    // 6. Return updated variants and campaign status
    res.json({ updated, campaignStatus });
  } catch (err) {
    res.status(500).json({ error: "Failed to bulk update variants" });
  }
});

export default router;
