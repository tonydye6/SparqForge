import { eq, and, sql } from "drizzle-orm";
import { db, brandsTable, assetsTable, templatesTable } from "@workspace/db";

interface ReadinessCheck {
  passed: boolean;
  label: string;
  count?: number;
}

export interface BrandReadinessResult {
  ready: boolean;
  missing: string[];
  checks: Record<string, ReadinessCheck>;
}

export async function checkBrandReadiness(brandId: string): Promise<BrandReadinessResult> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));

  if (!brand) {
    return {
      ready: false,
      missing: ["brand"],
      checks: {
        brand: { passed: false, label: "Brand exists" },
      },
    };
  }

  const logoCheck = !!brand.logoFileUrl && brand.logoFileUrl.trim().length > 0;
  const fontsCheck = Array.isArray(brand.brandFonts) && brand.brandFonts.length >= 1;
  const voiceCheck = !!brand.voiceDescription && brand.voiceDescription.trim().length > 0;
  const platformRulesCheck =
    typeof brand.platformRules === "object" &&
    brand.platformRules !== null &&
    Object.keys(brand.platformRules).length >= 1;

  const [approvedAssetResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brandId), eq(assetsTable.status, "approved")));
  const approvedAssetCount = approvedAssetResult?.count ?? 0;

  const [activeTemplateResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(templatesTable)
    .where(and(eq(templatesTable.brandId, brandId), eq(templatesTable.isActive, true)));
  const activeTemplateCount = activeTemplateResult?.count ?? 0;

  const checks: Record<string, ReadinessCheck> = {
    logo: { passed: logoCheck, label: "Brand logo uploaded" },
    fonts: { passed: fontsCheck, label: "At least one brand font" },
    voice: { passed: voiceCheck, label: "Voice description configured" },
    platformRules: { passed: platformRulesCheck, label: "Platform rules set" },
    approvedAssets: { passed: approvedAssetCount >= 1, label: "Approved assets available", count: approvedAssetCount },
    templates: { passed: activeTemplateCount >= 1, label: "Active template exists", count: activeTemplateCount },
  };

  const missing = Object.entries(checks)
    .filter(([, check]) => !check.passed)
    .map(([key]) => key);

  return {
    ready: missing.length === 0,
    missing,
    checks,
  };
}
