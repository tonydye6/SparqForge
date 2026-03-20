import { db, brandsTable, templatesTable, assetsTable, hashtagSetsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface SelectedAssetRef {
  assetId: string;
  role: "primary" | "supporting";
  order?: number;
}

export interface AssembledContext {
  brand: typeof brandsTable.$inferSelect;
  template: typeof templatesTable.$inferSelect;
  primaryAsset: typeof assetsTable.$inferSelect | null;
  supportingAssets: (typeof assetsTable.$inferSelect)[];
  combinedBrief: string;
  hashtagSets: (typeof hashtagSetsTable.$inferSelect)[];
  referenceAnalysis: Record<string, unknown> | null;
}

export async function assembleContext(params: {
  brandId: string;
  templateId: string;
  selectedAssets: SelectedAssetRef[];
  selectedHashtagSetIds?: string[];
  briefText?: string;
  referenceAnalysis?: Record<string, unknown> | null;
}): Promise<AssembledContext> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, params.brandId));
  if (!brand) throw new Error(`Brand not found: ${params.brandId}`);

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, params.templateId));
  if (!template) throw new Error(`Template not found: ${params.templateId}`);

  const primaryRef = params.selectedAssets.find(a => a.role === "primary");
  const supportingRefs = params.selectedAssets.filter(a => a.role === "supporting");

  let primaryAsset: typeof assetsTable.$inferSelect | null = null;
  if (primaryRef) {
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, primaryRef.assetId));
    primaryAsset = asset || null;
  }

  let supportingAssets: (typeof assetsTable.$inferSelect)[] = [];
  if (supportingRefs.length > 0) {
    supportingAssets = await db.select().from(assetsTable)
      .where(inArray(assetsTable.id, supportingRefs.map(r => r.assetId)));
  }

  const briefTexts: string[] = [];
  const contextAssets = params.selectedAssets.filter(a => a.role === "supporting");
  if (contextAssets.length > 0) {
    const contextItems = await db.select().from(assetsTable)
      .where(inArray(assetsTable.id, contextAssets.map(c => c.assetId)));
    for (const item of contextItems) {
      if (item.type === "context" && item.content) {
        briefTexts.push(item.content);
      }
    }
  }
  if (params.briefText) {
    briefTexts.push(params.briefText);
  }

  let hashtagSets: (typeof hashtagSetsTable.$inferSelect)[] = [];
  if (params.selectedHashtagSetIds && params.selectedHashtagSetIds.length > 0) {
    hashtagSets = await db.select().from(hashtagSetsTable)
      .where(inArray(hashtagSetsTable.id, params.selectedHashtagSetIds));
  } else {
    hashtagSets = await db.select().from(hashtagSetsTable)
      .where(eq(hashtagSetsTable.brandId, params.brandId));
  }

  return {
    brand,
    template,
    primaryAsset,
    supportingAssets,
    combinedBrief: briefTexts.join("\n\n"),
    hashtagSets,
    referenceAnalysis: params.referenceAnalysis || null,
  };
}
