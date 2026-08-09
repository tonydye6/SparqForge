/**
 * Phase 8 item 2 · the job that derives conclusions and stores them.
 *
 * The derivation itself is pure and lives in `performance-conclusions.ts`. This
 * file is the part that touches the world: it reads the posts, calls the pure
 * function, and writes the result. Splitting them that way is why every
 * threshold in the derivation is arguable in a test with no database.
 *
 * **It re-aggregates nothing.** The engagement figure is `likes + comments +
 * shares` off the latest snapshot, which is character-for-character what
 * `performance-insights.ts` already computes. A second definition of
 * "engagement" would let the metrics table and the conclusion above it disagree
 * about the same post, which is the sort of thing nobody notices until they are
 * arguing about which number is real.
 */
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  db,
  approvalsTable,
  brandsTable,
  calendarEntriesTable,
  creativeVariantsTable,
  creativesTable,
  designerPersonasTable,
  performanceConclusionsTable,
  postMetricsTable,
} from "@workspace/db";
import { deriveConclusions, type ConclusionPost, type DerivedConclusion } from "./performance-conclusions.js";
import { logger } from "../lib/logger";

/** Runs on the same cadence as the metrics poller, one cycle behind it. */
const DERIVE_INTERVAL_MS = 60 * 60_000;

/**
 * Every published post for a brand that has a metric snapshot, with the
 * attributes the four conclusion kinds need hung off it.
 *
 * All three optional attributes come from LEFT joins on purpose. A post whose
 * variant was deleted, or whose creative was never sent for approval, should
 * still count toward a window conclusion — dropping it would silently narrow
 * the sample that the card then reports as `n`.
 */
export async function loadConclusionPosts(brandId: string): Promise<ConclusionPost[]> {
  const entries = await db
    .select({
      id: calendarEntriesTable.id,
      platform: calendarEntriesTable.platform,
      publishedAt: calendarEntriesTable.publishedAt,
      creativeId: calendarEntriesTable.creativeId,
      personaId: creativeVariantsTable.personaId,
      personaName: designerPersonasTable.name,
      headlineRenderMode: creativeVariantsTable.headlineRenderMode,
    })
    .from(calendarEntriesTable)
    .innerJoin(creativesTable, eq(calendarEntriesTable.creativeId, creativesTable.id))
    .leftJoin(creativeVariantsTable, eq(calendarEntriesTable.variantId, creativeVariantsTable.id))
    .leftJoin(designerPersonasTable, eq(creativeVariantsTable.personaId, designerPersonasTable.id))
    .where(and(
      eq(creativesTable.brandId, brandId),
      eq(calendarEntriesTable.publishStatus, "published"),
      isNotNull(calendarEntriesTable.publishedAt),
    ));

  if (entries.length === 0) return [];

  const entryIds = entries.map(e => e.id);
  const latest = await db
    .selectDistinctOn([postMetricsTable.calendarEntryId], {
      calendarEntryId: postMetricsTable.calendarEntryId,
      likes: postMetricsTable.likes,
      comments: postMetricsTable.comments,
      shares: postMetricsTable.shares,
    })
    .from(postMetricsTable)
    .where(inArray(postMetricsTable.calendarEntryId, entryIds))
    .orderBy(postMetricsTable.calendarEntryId, sql`${postMetricsTable.fetchedAt} DESC`);
  const metricMap = new Map(latest.map(m => [m.calendarEntryId, m]));

  /*
   * Approval latency, keyed by creative. The MOST RECENT decided approval wins:
   * a creative sent back and re-approved was decided twice, and the decision
   * that mattered is the one that let it out of the door.
   */
  const creativeIds = [...new Set(entries.map(e => e.creativeId))];
  const decided = await db
    .selectDistinctOn([approvalsTable.creativeId], {
      creativeId: approvalsTable.creativeId,
      requestedAt: approvalsTable.requestedAt,
      decidedAt: approvalsTable.decidedAt,
    })
    .from(approvalsTable)
    .where(and(
      inArray(approvalsTable.creativeId, creativeIds),
      isNotNull(approvalsTable.decidedAt),
    ))
    .orderBy(approvalsTable.creativeId, sql`${approvalsTable.decidedAt} DESC`);
  const latencyMap = new Map<string, number>();
  for (const row of decided) {
    if (!row.decidedAt) continue;
    const ms = row.decidedAt.getTime() - row.requestedAt.getTime();
    // A negative latency is a clock or a backfill, not a fast approval.
    if (ms >= 0) latencyMap.set(row.creativeId, ms);
  }

  const posts: ConclusionPost[] = [];
  for (const entry of entries) {
    const m = metricMap.get(entry.id);
    if (!m) continue; // no snapshot yet — nothing to learn from
    posts.push({
      calendarEntryId: entry.id,
      platform: entry.platform,
      publishedAt: entry.publishedAt,
      engagements: (m.likes || 0) + (m.comments || 0) + (m.shares || 0),
      approvalLatencyMs: latencyMap.get(entry.creativeId) ?? null,
      personaId: entry.personaId,
      personaName: entry.personaName,
      headlineRenderMode: entry.headlineRenderMode,
    });
  }
  return posts;
}

export interface StoreOutcome {
  inserted: number;
  updated: number;
  /** Rows left alone because a human had already applied or dismissed them. */
  respected: number;
}

/**
 * Write the derived conclusions, without ever overruling a person.
 *
 * A conclusion someone has APPLIED or DISMISSED is left exactly as it is. Only
 * rows still sitting at `proposed` get refreshed, and refreshing one updates
 * its numbers rather than its identity — the same finding, restated with this
 * week's evidence.
 *
 * That asymmetry is the whole behaviour. Without it a dismissed card returns on
 * the next cycle and the Dismiss button is decoration, which is precisely how
 * `brands.compositionRules` came to keep retired rules rather than delete them.
 */
export async function storeConclusions(
  brandId: string,
  derived: readonly DerivedConclusion[],
): Promise<StoreOutcome> {
  const outcome: StoreOutcome = { inserted: 0, updated: 0, respected: 0 };
  if (derived.length === 0) return outcome;

  const existing = await db
    .select({
      id: performanceConclusionsTable.id,
      conclusionKey: performanceConclusionsTable.conclusionKey,
      status: performanceConclusionsTable.status,
    })
    .from(performanceConclusionsTable)
    .where(and(
      eq(performanceConclusionsTable.brandId, brandId),
      inArray(performanceConclusionsTable.conclusionKey, derived.map(c => c.key)),
    ));
  const byKey = new Map(existing.map(r => [r.conclusionKey, r]));

  for (const c of derived) {
    const prior = byKey.get(c.key);
    if (prior && prior.status !== "proposed") {
      outcome.respected += 1;
      continue;
    }
    if (prior) {
      await db.update(performanceConclusionsTable)
        .set({
          kind: c.kind,
          statement: c.statement,
          evidence: c.evidence,
          confidence: c.confidence,
          appliesTo: c.appliesTo,
        })
        .where(eq(performanceConclusionsTable.id, prior.id));
      outcome.updated += 1;
    } else {
      await db.insert(performanceConclusionsTable).values({
        brandId,
        conclusionKey: c.key,
        kind: c.kind,
        statement: c.statement,
        evidence: c.evidence,
        confidence: c.confidence,
        appliesTo: c.appliesTo,
        status: "proposed",
      });
      outcome.inserted += 1;
    }
  }
  return outcome;
}

/**
 * Withdraw proposals the evidence no longer supports.
 *
 * A window that stopped outperforming should stop being offered. Only
 * `proposed` rows are removed, so an applied rule keeps the row that records
 * where it came from, and a dismissed one keeps the row that stops it returning.
 */
export async function retireStaleProposals(
  brandId: string,
  liveKeys: readonly string[],
): Promise<number> {
  const conditions = [
    eq(performanceConclusionsTable.brandId, brandId),
    eq(performanceConclusionsTable.status, "proposed"),
  ];
  // `notInArray` with an empty list is a drizzle error rather than a no-op, and
  // an empty list is the ordinary case: it means the evidence now supports
  // nothing, so every standing proposal is stale.
  if (liveKeys.length > 0) {
    conditions.push(notInArray(performanceConclusionsTable.conclusionKey, [...liveKeys]));
  }
  const stale = await db
    .select({ id: performanceConclusionsTable.id })
    .from(performanceConclusionsTable)
    .where(and(...conditions));
  if (stale.length === 0) return 0;
  await db.delete(performanceConclusionsTable)
    .where(inArray(performanceConclusionsTable.id, stale.map(r => r.id)));
  return stale.length;
}

export async function deriveAndStoreForBrand(brandId: string): Promise<StoreOutcome & { derived: number; retired: number }> {
  /*
   * The BRAND's clock decides what "the evening" means, not the server's.
   * `published_at` is a bare timestamp the driver hands back as UTC, so reading
   * its hour without a zone silently reports findings in whichever timezone the
   * process happens to run in — which turned a seeded evenings-beat-mornings
   * spread into a midday finding on a Los Angeles machine.
   */
  const [brand] = await db.select({ timezone: brandsTable.timezone })
    .from(brandsTable).where(eq(brandsTable.id, brandId));
  const posts = await loadConclusionPosts(brandId);
  const derived = deriveConclusions(posts, brand?.timezone ?? undefined);
  const outcome = await storeConclusions(brandId, derived);
  const retired = await retireStaleProposals(brandId, derived.map(c => c.key));
  return { ...outcome, derived: derived.length, retired };
}

export async function deriveConclusionsForAllBrands(): Promise<void> {
  try {
    const brands = await db.select({ id: brandsTable.id, name: brandsTable.name }).from(brandsTable);
    for (const brand of brands) {
      try {
        const result = await deriveAndStoreForBrand(brand.id);
        if (result.derived > 0 || result.retired > 0) {
          logger.info({ brand: brand.name, ...result }, "Derived performance conclusions");
        }
      } catch (err) {
        // One brand's bad data must not stop the others being looked at.
        logger.error({ err, brandId: brand.id }, "Conclusion derivation failed for brand");
      }
    }
  } catch (err) {
    logger.error({ err }, "Conclusion derivation poll error");
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startConclusionsScheduler(): void {
  if (intervalId) {
    logger.warn("Conclusions scheduler already running");
    return;
  }
  logger.info({ intervalMs: DERIVE_INTERVAL_MS }, "Starting performance conclusions scheduler");
  intervalId = setInterval(deriveConclusionsForAllBrands, DERIVE_INTERVAL_MS);
  deriveConclusionsForAllBrands();
}

export function stopConclusionsScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Conclusions scheduler stopped");
  }
}
