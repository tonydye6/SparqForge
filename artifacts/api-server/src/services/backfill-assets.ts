import { db, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function backfillAssetClassifications(): Promise<{ updated: number; details: string[] }> {
  const allAssets = await db.select().from(assetsTable);
  const details: string[] = [];

  const updates: { id: string; data: Record<string, unknown>; label: string }[] = [];

  for (const asset of allAssets) {
    if (asset.assetClass !== "subject_reference") continue;

    let assetClass = "subject_reference";
    let generationRole: string | null = null;
    let compositingOnly = false;
    let generationAllowed = true;
    let approvedForCompositing = false;

    const nameLower = (asset.name || "").toLowerCase();
    const subTypeLower = (asset.subType || "").toLowerCase();
    const typeLower = (asset.type || "").toLowerCase();

    if (typeLower === "context") {
      assetClass = "context";
      generationAllowed = false;
      approvedForCompositing = false;
    } else if (
      subTypeLower.includes("logo") ||
      nameLower.includes("logo") ||
      typeLower === "logo"
    ) {
      assetClass = "compositing";
      compositingOnly = true;
      generationAllowed = false;
      generationRole = "compositing_logo";
      approvedForCompositing = true;
    } else if (
      subTypeLower.includes("background") ||
      nameLower.includes("background") ||
      subTypeLower.includes("mood") ||
      nameLower.includes("style")
    ) {
      assetClass = "style_reference";
    } else if (
      subTypeLower.includes("character") ||
      subTypeLower.includes("render") ||
      subTypeLower.includes("gameplay") ||
      subTypeLower.includes("screenshot")
    ) {
      assetClass = "subject_reference";
    }

    const needsUpdate =
      assetClass !== "subject_reference" ||
      compositingOnly !== false ||
      generationAllowed !== true ||
      approvedForCompositing !== false ||
      generationRole !== null;

    if (needsUpdate) {
      updates.push({
        id: asset.id,
        data: {
          assetClass,
          generationRole,
          compositingOnly,
          generationAllowed,
          approvedForCompositing,
          updatedAt: new Date(),
        },
        label: `${asset.name}: ${asset.type}/${asset.subType || 'none'} → ${assetClass}`,
      });
    }
  }

  if (updates.length === 0) {
    return { updated: 0, details };
  }

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx.update(assetsTable)
        .set(update.data)
        .where(eq(assetsTable.id, update.id));
      details.push(update.label);
    }
  });

  return { updated: updates.length, details };
}
