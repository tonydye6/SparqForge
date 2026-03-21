import { db, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function backfillAssetClassifications(): Promise<{ updated: number; details: string[] }> {
  const allAssets = await db.select().from(assetsTable);
  let updated = 0;
  const details: string[] = [];

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
      await db.update(assetsTable)
        .set({
          assetClass,
          generationRole,
          compositingOnly,
          generationAllowed,
          approvedForCompositing,
          updatedAt: new Date(),
        })
        .where(eq(assetsTable.id, asset.id));
      updated++;
      details.push(`${asset.name}: ${asset.type}/${asset.subType || 'none'} → ${assetClass}`);
    }
  }

  return { updated, details };
}
