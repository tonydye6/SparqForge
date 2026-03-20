import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, campaignVariantsTable, campaignsTable, refinementLogsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/campaigns/:campaignId/variants", async (req, res): Promise<void> => {
  const { campaignId } = req.params;
  const variants = await db
    .select()
    .from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.campaignId, campaignId as string))
    .orderBy(campaignVariantsTable.platform);

  res.json(variants);
});

router.post("/campaigns/:campaignId/variants", async (req, res): Promise<void> => {
  const { campaignId } = req.params;
  const { platform, aspectRatio, caption, headlineText } = req.body;

  if (!platform || !aspectRatio) {
    res.status(400).json({ error: "Missing required fields: platform, aspectRatio" });
    return;
  }

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
});

router.put("/campaigns/:campaignId/variants/:variantId", async (req, res): Promise<void> => {
  const { campaignId, variantId } = req.params;
  const updates: Record<string, unknown> = {};

  if (req.body.caption !== undefined) updates.caption = req.body.caption;
  if (req.body.headlineText !== undefined) updates.headlineText = req.body.headlineText;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.rawImageUrl !== undefined) updates.rawImageUrl = req.body.rawImageUrl;
  if (req.body.compositedImageUrl !== undefined) updates.compositedImageUrl = req.body.compositedImageUrl;

  updates.updatedAt = new Date();

  const [existingVariant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, variantId as string));

  const [variant] = await db
    .update(campaignVariantsTable)
    .set(updates)
    .where(eq(campaignVariantsTable.id, variantId as string))
    .returning();

  if (!variant) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  const newStatus = req.body.status;
  if (existingVariant && (newStatus === "approved" || newStatus === "rejected")) {
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
        userId: "system",
      });
    }
  }

  res.json(variant);
});

export default router;
