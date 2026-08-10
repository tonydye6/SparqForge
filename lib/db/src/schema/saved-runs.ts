import { pgTable, text, integer, timestamp, jsonb, index, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { creativesTable } from "./creatives";
import { usersTable } from "./users";
import { STAGE_KINDS, TAKE_ORIGINS, type StageKind, type TakeOrigin } from "./stages";

/**
 * Phase 10 · M8 · saved runs and cross-brand fan-out.
 *
 * Doc 21 §3.7 and doc 22 Phase 10 items 2 and 3. A saved run is a brief plus
 * whichever later stages were locked, replayable. Running it against several
 * brands is the cross-brand case: one idea, N brand contracts, N sets of
 * outputs.
 *
 * Doc 21 §4.6 is the line to hold: `templates` are CREATIVE templates (layouts)
 * and `saved_runs` are PROCESS templates (a replayable session). They are
 * different things and must not be merged.
 *
 * THREE DELIBERATE DEVIATIONS FROM DOC 21 §3.7, all recorded here rather than
 * discovered later:
 *
 * 1. Doc 21 puts a nullable `brandId` on `saved_runs` and says "null with rows
 *    in saved_run_brands is the cross-brand case". That shape has an unrunnable
 *    state in it: brandId null AND no target rows is a run with nowhere to go.
 *    Here the target set is the ONLY place brands live. A single-brand run is
 *    one row in `saved_run_brands`, a cross-brand run is several, and there is
 *    no third encoding to get wrong.
 *
 * 2. Because the brand moved out, provenance needs somewhere else to live, so
 *    `sourceCreativeId` records the creative the snapshot was captured from. It
 *    is more useful than the brand id it replaces: it is what "open the one
 *    this came from" needs, and the brand is reachable through it.
 *
 * 3. "At least one target" cannot be a CHECK, because a CHECK cannot see
 *    another table. It is a DEFERRED constraint trigger instead, so a run and
 *    its targets can be inserted in either order inside one transaction and the
 *    empty case is refused at COMMIT. That closes the born-broken hole the same
 *    way `0038` closed it for clips, rather than trusting every writer.
 */

/** The snapshot version. Bumped if the replay contract ever changes shape. */
export const RUN_SNAPSHOT_VERSION = 1;

/** One slot's current take, as captured. */
export interface SavedRunSlot {
  slotKey: string;
  origin: TakeOrigin;
  payload: unknown;
}

/** One stage of the captured run. */
export interface SavedRunStage {
  stageNumber: number;
  stageKind: StageKind;
  /** Whether the stage was locked at capture time. Locked stages replay. */
  locked: boolean;
  slots: SavedRunSlot[];
  /**
   * What this stage consumed, recorded as stage KINDS rather than ids.
   *
   * The ids in `stage_states.consumed_from` belong to the creative the run was
   * captured from and mean nothing in the spine a replay creates. Kinds are the
   * same on every creative, so the dependency graph survives the trip and
   * staleness keeps working in the replayed post.
   */
  consumedFromKinds: StageKind[];
}

/**
 * What gets replayed.
 *
 * `sourceBrandId` is recorded so a replay can tell whether it is landing in the
 * brand the run was captured from. That single comparison is what decides
 * whether brand-owned rows are carried across or re-derived, and getting it
 * wrong is how a Crown U rule would end up quietly binding a Rumble U post.
 */
export interface RunSnapshot {
  version: number;
  sourceBrandId: string | null;
  stages: SavedRunStage[];
}

export const savedRunsTable = pgTable("saved_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  /**
   * The creative this was captured from. SET NULL rather than cascade: the run
   * is a thing in its own right once saved, and deleting the post it came from
   * must not delete the process somebody saved off the back of it.
   */
  sourceCreativeId: text("source_creative_id")
    .references(() => creativesTable.id, { onDelete: "set null" }),
  /**
   * Which stage numbers replay. Derived from what was locked at capture time,
   * then editable, because "replay the brief only" and "replay the brief and
   * the direction" are different intentions about the same saved run.
   */
  lockedStages: jsonb("locked_stages").$type<number[]>().notNull().default([]),
  /** The stage payloads to replay. See RunSnapshot. */
  templateSnapshot: jsonb("template_snapshot").$type<RunSnapshot>().notNull(),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at"),
  createdBy: text("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("saved_runs_created_idx").on(table.createdAt),
  /** An unnamed run is unfindable in a list, which is the only place it lives. */
  check("saved_runs_name_present_check", sql`length(btrim(${table.name})) > 0`),
  /**
   * The engine iterates both of these. A JSON `null` or a bare string is not
   * SQL NULL, so `notNull()` alone does not keep a non-array out of the array
   * column: the same reasoning as `stage_states.consumed_from`.
   */
  check("saved_runs_locked_stages_is_array_check", sql`jsonb_typeof(${table.lockedStages}) = 'array'`),
  check("saved_runs_snapshot_is_object_check", sql`jsonb_typeof(${table.templateSnapshot}) = 'object'`),
  check("saved_runs_run_count_check", sql`${table.runCount} >= 0`),
  /**
   * A row cannot lie about its own history. `runCount > 0` and `lastRunAt`
   * are two records of the same fact, and either one without the other makes
   * the list read wrong: "run 4 times, never" or "last run today, 0 times".
   * Same class of guard as `sequences_rendered_has_output_check`.
   */
  check(
    "saved_runs_run_history_check",
    sql`(${table.runCount} > 0) = (${table.lastRunAt} IS NOT NULL)`,
  ),
]);

/**
 * The brands a run fans out to. One row is an ordinary run, several rows is
 * cross-brand.
 *
 * CASCADE on both sides. Deleting a brand must not be blocked by an old saved
 * run (the mistake `0037` found the hard way, where a CHECK fired on a cascade
 * and made deleting a library asset fail outright with an error that never
 * mentioned sequences). The trigger in the migration cleans up a run whose last
 * target went away.
 */
export const savedRunBrandsTable = pgTable("saved_run_brands", {
  savedRunId: text("saved_run_id").notNull()
    .references(() => savedRunsTable.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull()
    .references(() => brandsTable.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.savedRunId, table.brandId], name: "saved_run_brands_pk" }),
  /** "Which runs target this brand" is the read the brand page makes. */
  index("saved_run_brands_brand_idx").on(table.brandId),
]);

export const savedRunSlotSchema = z.object({
  slotKey: z.string().min(1).max(64),
  origin: z.enum(TAKE_ORIGINS),
  payload: z.unknown(),
});

export const savedRunStageSchema = z.object({
  stageNumber: z.int().min(1).max(5),
  stageKind: z.enum(STAGE_KINDS),
  locked: z.boolean(),
  slots: z.array(savedRunSlotSchema),
  consumedFromKinds: z.array(z.enum(STAGE_KINDS)).default([]),
});

export const runSnapshotSchema = z.object({
  version: z.int().min(1),
  sourceBrandId: z.string().nullable(),
  stages: z.array(savedRunStageSchema),
});

export const insertSavedRunSchema = createInsertSchema(savedRunsTable, {
  name: z.string().min(1).max(120),
  lockedStages: z.array(z.int().min(1).max(5)),
  templateSnapshot: runSnapshotSchema,
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertSavedRunBrandSchema = createInsertSchema(savedRunBrandsTable);

export type SavedRun = typeof savedRunsTable.$inferSelect;
export type SavedRunBrand = typeof savedRunBrandsTable.$inferSelect;
export type InsertSavedRun = z.infer<typeof insertSavedRunSchema>;
