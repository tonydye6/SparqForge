import { pgTable, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { usersTable } from "./users";

/**
 * What a conclusion is about. Spec: 21_SPEC_01_DATA_MODEL §3.5.
 *
 *  - `persona`       a director outperforms or underperforms the house style
 *  - `composition`   a compositional choice correlates with performance
 *  - `window`        a posting time outperforms
 *  - `disagreement`  **the one that earns the table.** The post approved
 *                    fastest was among the worst performers. Every other kind
 *                    tells you about the work; this one tells you about the
 *                    judgement, which is the only kind a person cannot get by
 *                    looking harder at their own numbers.
 */
export type ConclusionKind = "persona" | "composition" | "window" | "disagreement";
export const CONCLUSION_KINDS = [
  "persona",
  "composition",
  "window",
  "disagreement",
] as const satisfies readonly ConclusionKind[];

/**
 * Proposed until a human decides. Doc 20 §2.9: "a system that silently retrains
 * on your numbers is one you cannot audit." Nothing here changes what the next
 * session proposes until somebody applies it.
 */
export type ConclusionStatus = "proposed" | "applied" | "dismissed";
export const CONCLUSION_STATUSES = [
  "proposed",
  "applied",
  "dismissed",
] as const satisfies readonly ConclusionStatus[];

export type ConclusionConfidence = "low" | "medium" | "high";

/**
 * Phase 8 · M6 · the loop that was missing.
 *
 * `post_metrics` has collected published performance since v1 and
 * `performance-insights.ts` already turns it into readable insight. What has
 * never existed is a conclusion you can ACT on: the insights layer computes,
 * mirrors into `signals`, and stops. Nothing it produced could be applied,
 * refused, or attributed afterwards.
 *
 * That is the difference this table makes. A conclusion carries the write it
 * would perform (`appliesTo`), who performed it and when — so "the next session
 * proposes something different" is a traceable consequence of a decision
 * somebody made, rather than a model quietly drifting on last month's numbers.
 */
export const performanceConclusionsTable = pgTable("performance_conclusions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  /**
   * What the finding is ABOUT, stable across re-derivations. `window:twitter:evening`.
   *
   * The derivation job runs on a timer, so without this every pass inserts a
   * fresh copy of every standing finding: the surface fills with duplicates and
   * dismissing one accomplishes nothing, because the next pass puts it straight
   * back. The unique index below is what turns the job's write into an upsert.
   *
   * Derived from the SUBJECT of the finding and never from its numbers, so a
   * conclusion that strengthens from 1.4x to 1.9x is still the same conclusion
   * and keeps whatever decision a human already made about it.
   * `brands.compositionRules.conclusionId` is the same idea and points here.
   */
  conclusionKey: text("conclusion_key").notNull(),
  kind: text("kind").$type<ConclusionKind>().notNull(),
  /** Plain sentence, e.g. "Ava K outperforms house style by 2.3x saves". */
  statement: text("statement").notNull(),
  /**
   * `{ n, metric, effectSize, entryIds[] }`.
   *
   * **`n` is mandatory and a CHECK enforces it** — see below. The spec calls it
   * mandatory and rendered, and the reason is doc 24 §5.4: a green number with
   * no sample size behind it is how a suite of 41 passing assertions coexisted
   * with a crash path. A conclusion that will not say how many posts it saw is
   * an opinion.
   */
  evidence: jsonb("evidence").notNull(),
  confidence: text("confidence").$type<ConclusionConfidence>().notNull(),
  status: text("status").$type<ConclusionStatus>().notNull().default("proposed"),
  /**
   * The write applying this would perform: `{ table, field, value }`. Recorded
   * BEFORE anyone applies, so the offer and the effect cannot diverge — the
   * card shows exactly what it is about to change.
   */
  appliesTo: jsonb("applies_to"),
  appliedAt: timestamp("applied_at"),
  appliedBy: text("applied_by").references(() => usersTable.id, { onDelete: "set null" }),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("performance_conclusions_brand_status_idx")
    .on(table.brandId, table.status, table.createdAt.desc()),
  /**
   * One row per finding per brand, enforced rather than trusted to the job.
   *
   * This is the constraint that makes "dismissed stays dismissed" true. The job
   * upserts against it and deliberately does NOT touch a row a human has
   * already applied or dismissed, so a decision survives every later pass.
   */
  uniqueIndex("performance_conclusions_brand_key_uq").on(table.brandId, table.conclusionKey),
  check(
    "performance_conclusions_kind_check",
    sql`${table.kind} IN ('persona', 'composition', 'window', 'disagreement')`,
  ),
  check(
    "performance_conclusions_status_check",
    sql`${table.status} IN ('proposed', 'applied', 'dismissed')`,
  ),
  check(
    "performance_conclusions_confidence_check",
    sql`${table.confidence} IN ('low', 'medium', 'high')`,
  ),
  /**
   * **A conclusion must say how many posts it saw.** Enforced in the database
   * rather than trusted to the generator, exactly as M3 made a `refused` state
   * without a reason impossible. `n` must be present AND numeric AND positive:
   * a conclusion drawn from zero posts is not a weak conclusion, it is not a
   * conclusion.
   */
  check(
    "performance_conclusions_evidence_n_check",
    sql`(${table.evidence} -> 'n') IS NOT NULL
        AND jsonb_typeof(${table.evidence} -> 'n') = 'number'
        AND (${table.evidence} ->> 'n')::numeric > 0`,
  ),
  /**
   * An applied conclusion must record WHEN, a dismissed one must record when it
   * was dismissed, and a proposed one must claim neither. Without this, "status"
   * and its timestamps can disagree and the audit trail the status exists to
   * provide quietly stops being one.
   */
  check(
    "performance_conclusions_decision_provenance_check",
    sql`(${table.status} = 'applied'   AND ${table.appliedAt} IS NOT NULL AND ${table.dismissedAt} IS NULL)
     OR (${table.status} = 'dismissed' AND ${table.dismissedAt} IS NOT NULL AND ${table.appliedAt} IS NULL)
     OR (${table.status} = 'proposed'  AND ${table.appliedAt} IS NULL AND ${table.dismissedAt} IS NULL)`,
  ),
  /** Applying writes something. A conclusion with nothing to write cannot be applied. */
  check(
    "performance_conclusions_applied_has_target_check",
    sql`${table.status} <> 'applied' OR ${table.appliesTo} IS NOT NULL`,
  ),
]);

export const insertPerformanceConclusionSchema = createInsertSchema(performanceConclusionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPerformanceConclusion = z.infer<typeof insertPerformanceConclusionSchema>;
export type PerformanceConclusion = typeof performanceConclusionsTable.$inferSelect;
