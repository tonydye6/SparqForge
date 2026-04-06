import { db, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const FRANCHISE_MAP: Record<string, string> = {
  crownu: "Crown U",
  rumbleu: "Rumble U",
  mascotmayhem: "Mascot Mayhem",
  sparq: "Sparq",
};

const KNOWN_SCHOOLS = new Set([
  "alabama", "duke", "florida", "fsu", "georgia", "iowa", "kentucky",
  "lsu", "miami", "michigan", "notre-dame", "oregon", "penn-state",
  "smu", "texas", "unc", "utah", "wisconsin", "cal", "nc-state", "washington",
]);

const BRAND_LAYER_LOGO_MAP: Record<string, string> = {
  sparq_logo: "primary_logo",
  crownu_logo: "secondary_mark",
  rumbleu_logo: "secondary_mark",
  mascotmayhem_logo: "secondary_mark",
  uni_logo: "partner",
  partner_logo: "partner",
};

const DEFAULT_SCORES: Record<string, { identity: number; style: number; freshness: number }> = {
  subject_reference: { identity: 4, style: 2, freshness: 3 },
  compositing: { identity: 5, style: 1, freshness: 3 },
  style_reference: { identity: 2, style: 4, freshness: 3 },
};
const FALLBACK_SCORES = { identity: 3, style: 3, freshness: 3 };

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function detectFranchise(nameLower: string): string | null {
  const prefix = nameLower.split("_")[0];
  return FRANCHISE_MAP[prefix] ?? null;
}

function detectBrandLayer(nameLower: string): string | null {
  for (const [pattern, layer] of Object.entries(BRAND_LAYER_LOGO_MAP)) {
    if (nameLower.startsWith(pattern + "_")) {
      return layer;
    }
  }
  return null;
}

function detectConflictTags(nameLower: string): string[] | null {
  const segments = stripExtension(nameLower).split("_");
  if (segments.length < 4) return null;
  if (segments[0] !== "crownu") return null;
  if (segments[1] !== "character" && segments[1] !== "char") return null;

  const schoolSegment = segments[3];
  if (KNOWN_SCHOOLS.has(schoolSegment)) {
    return [schoolSegment];
  }
  return null;
}

function buildCharacterIdentityNote(nameLower: string): string | null {
  const segments = stripExtension(nameLower).split("_");
  if (segments.length < 5) return null;
  if (segments[1] !== "character" && segments[1] !== "char") return null;

  const gender = segments[2];
  const schoolOrColors = segments[3];
  const sport = segments[4];
  const pose = segments.length >= 6 ? segments[5] : "default";

  const prettySchool = schoolOrColors.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const prettyGender = gender.charAt(0).toUpperCase() + gender.slice(1);
  const prettySport = sport.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  return `${prettyGender} ${prettySchool} ${prettySport.toLowerCase()} character, ${pose} pose`;
}

function classifyAsset(nameLower: string, subTypeLower: string, typeLower: string) {
  let assetClass = "subject_reference";
  let generationRole: string | null = null;
  let compositingOnly = false;
  let generationAllowed = true;
  let approvedForCompositing = false;

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
    generationRole = "supporting";
  } else if (
    subTypeLower.includes("character") ||
    nameLower.includes("character") ||
    nameLower.includes("char_") ||
    subTypeLower.includes("render") ||
    nameLower.includes("render")
  ) {
    assetClass = "subject_reference";
    generationRole = "primary_subject";
  } else if (
    subTypeLower.includes("gameplay") ||
    nameLower.includes("gameplay") ||
    subTypeLower.includes("screenshot") ||
    nameLower.includes("screenshot")
  ) {
    assetClass = "subject_reference";
    generationRole = "supporting";
  }

  return { assetClass, generationRole, compositingOnly, generationAllowed, approvedForCompositing };
}

export async function backfillAssetClassifications(): Promise<{ updated: number; details: string[] }> {
  const allAssets = await db.select().from(assetsTable);
  const details: string[] = [];

  const updates: { id: string; data: Record<string, unknown>; label: string }[] = [];

  for (const asset of allAssets) {
    const nameLower = (asset.name || "").toLowerCase();
    const subTypeLower = (asset.subType || "").toLowerCase();
    const typeLower = (asset.type || "").toLowerCase();

    const classification = classifyAsset(nameLower, subTypeLower, typeLower);

    const data: Record<string, unknown> = {};
    let changed = false;

    if (asset.assetClass === null || asset.assetClass === "subject_reference") {
      if (classification.assetClass !== (asset.assetClass ?? "subject_reference") ||
          classification.generationRole !== asset.generationRole) {
        data.assetClass = classification.assetClass;
        data.generationRole = classification.generationRole;
        changed = true;
      }
    }

    const resolvedClass = (data.assetClass as string) || asset.assetClass || "subject_reference";

    if (asset.compositingOnly === null || asset.compositingOnly === false) {
      if (classification.compositingOnly !== (asset.compositingOnly ?? false)) {
        data.compositingOnly = classification.compositingOnly;
        changed = true;
      }
    }
    if (asset.generationAllowed === null || asset.generationAllowed === true) {
      if (classification.generationAllowed !== (asset.generationAllowed ?? true)) {
        data.generationAllowed = classification.generationAllowed;
        changed = true;
      }
    }
    if (asset.approvedForCompositing === null || asset.approvedForCompositing === false) {
      if (classification.approvedForCompositing !== (asset.approvedForCompositing ?? false)) {
        data.approvedForCompositing = classification.approvedForCompositing;
        changed = true;
      }
    }

    if (asset.franchise === null) {
      const franchise = detectFranchise(nameLower);
      if (franchise) {
        data.franchise = franchise;
        changed = true;
      }
    }

    if (asset.brandLayer === null) {
      const brandLayer = detectBrandLayer(nameLower);
      if (brandLayer) {
        data.brandLayer = brandLayer;
        changed = true;
      }
    }

    if (asset.conflictTags === null) {
      const tags = detectConflictTags(nameLower);
      if (tags && tags.length > 0) {
        data.conflictTags = tags;
        changed = true;
      }
    }

    const scores = DEFAULT_SCORES[resolvedClass] || FALLBACK_SCORES;
    if (asset.subjectIdentityScore === null) {
      data.subjectIdentityScore = scores.identity;
      changed = true;
    }
    if (asset.styleStrengthScore === null) {
      data.styleStrengthScore = scores.style;
      changed = true;
    }
    if (asset.freshnessScore === null) {
      data.freshnessScore = scores.freshness;
      changed = true;
    }

    if (!asset.characterIdentityNote || asset.characterIdentityNote === "") {
      const isCharacter =
        nameLower.includes("character") || nameLower.includes("char_") ||
        subTypeLower.includes("character");
      if (isCharacter) {
        const note = buildCharacterIdentityNote(nameLower);
        if (note) {
          data.characterIdentityNote = note;
          changed = true;
        }
      }
    }

    if (changed) {
      data.updatedAt = new Date();
      const changedFields = Object.keys(data).filter(k => k !== "updatedAt").join(", ");
      updates.push({
        id: asset.id,
        data,
        label: `${asset.name}: updated [${changedFields}]`,
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
