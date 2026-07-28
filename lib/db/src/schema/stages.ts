import {
  pgTable, text, timestamp, integer, boolean, jsonb, index, unique, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativesTable } from "./creatives";
import { usersTable } from "./users";

/**
 * The spine. One row per stage per creative.
 *
 * Spec: SparqMake Sandbox/21_SPEC_01_DATA_MODEL.md §3.1, and
 * 20_SPEC_00_PRINCIPLES.md §1.1 to §1.5.
 *
 * The load-bearing idea, and the one that is easiest to accidentally undo:
 *
 *   DISPLAY ORDER AND DEPENDENCY ARE DIFFERENT THINGS.
 *
 * `stageNumber` is a fixed reading convention. It is what makes the row
 * learnable, and it never changes. `consumedFrom` is what a stage actually
 * used, and it is the truth. Staleness is computed by walking `consumedFrom`,
 * NEVER by comparing stage numbers.
 *
 * That distinction is what lets a hook authored before any image existed
 * survive an image re-run, and what makes a Voice slot at stage 03 legitimately
 * consume a script written at stage 04 without any special-casing.
 *
 * Every union column below carries BOTH a `.$type<>()` (so a DB row can be fed
 * to the engine without an unchecked cast) AND a CHECK constraint (so the
 * database refuses a value the type system thinks is impossible). Following the
 * precedent already set by calendar_entries in creatives.ts.
 */

/** The five fixed stages. A sixth is a product decision, never a user action. */
export const STAGE_KINDS = ["brief", "direction", "asset", "copy", "crops"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/** Canonical order. Index + 1 is the stageNumber, enforced by a CHECK below. */
export const STAGE_ORDER: readonly StageKind[] = STAGE_KINDS;

/** Two modes of one stage, not two screens. */
export const STAGE_MODES = ["explore", "refine"] as const;
export type StageMode = (typeof STAGE_MODES)[number];

/**
 * `stale` means "built on something you have since reopened", not "wrong".
 * `locked` means this stage is now an input to every other stage, wherever it
 * sits in the row.
 */
export const STAGE_STATUSES = ["empty", "active", "done", "stale", "locked"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * Where a take came from. `user_typed` is special: it triggers auto-lock, so a
 * hand-written caption cannot be silently overwritten by an upstream re-run.
 * `region_edit` is distinguished from `generated` so a small correction reads
 * differently from a whole new attempt in the history list.
 */
export const TAKE_ORIGINS = ["generated", "region_edit", "user_typed", "swapped_in"] as const;
export type TakeOrigin = (typeof TAKE_ORIGINS)[number];

/** Small helper so the CHECK expressions below stay readable. */
const oneOf = (col: string, values: readonly string[]) =>
  sql.raw(`"${col}" in (${values.map((v) => `'${v}'`).join(", ")})`);

export const stageStatesTable = pgTable(
  "stage_states",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    creativeId: text("creative_id").notNull()
      .references(() => creativesTable.id, { onDelete: "cascade" }),
    // 1..5. A reading convention, not a dependency.
    stageNumber: integer("stage_number").notNull(),
    stageKind: text("stage_kind").$type<StageKind>().notNull(),
    mode: text("mode").$type<StageMode>().notNull().default("explore"),
    status: text("status").$type<StageStatus>().notNull().default("empty"),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by").references(() => usersTable.id, { onDelete: "set null" }),
    /**
     * Ids of the stage_states rows this stage actually consumed. THE dependency
     * graph. An empty array means nothing can stale this stage, which is
     * exactly the case for copy authored before an image existed.
     *
     * `.$type<string[]>()` matters more here than anywhere else in the schema.
     * Without it drizzle infers `unknown`, every caller casts blindly, and a
     * malformed value reaches the traversal. Note that `.notNull()` alone does
     * NOT prevent the JSON value `null` from being stored, because JSON null is
     * not SQL NULL, so the jsonb_typeof CHECK below is doing real work.
     */
    consumedFrom: jsonb("consumed_from").$type<string[]>().notNull().default([]),
    decidedAt: timestamp("decided_at"),
    /** Why this went stale, so the UI can say it rather than just colour it. */
    supersededReason: text("superseded_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One row per stage per creative. The spine has a fixed shape. This unique
    // constraint already creates a btree on (creative_id, stage_number), so no
    // separate index on the same columns is needed.
    unique("stage_states_creative_stage_uq").on(table.creativeId, table.stageNumber),
    // Every realistic status query is creative-scoped, so lead with creative_id
    // rather than indexing a five-value column across the whole table.
    index("stage_states_creative_status_idx").on(table.creativeId, table.status),
    check("stage_states_number_range_check", sql`${table.stageNumber} between 1 and 5`),
    check("stage_states_kind_check", oneOf("stage_kind", STAGE_KINDS)),
    check("stage_states_mode_check", oneOf("mode", STAGE_MODES)),
    check("stage_states_status_check", oneOf("status", STAGE_STATUSES)),
    // stage_number and stage_kind must agree, so STAGE_ORDER's "index + 1"
    // contract is backed by the database rather than by convention.
    check(
      "stage_states_number_kind_check",
      sql.raw(
        `("stage_number" = 1 and "stage_kind" = 'brief') or ` +
        `("stage_number" = 2 and "stage_kind" = 'direction') or ` +
        `("stage_number" = 3 and "stage_kind" = 'asset') or ` +
        `("stage_number" = 4 and "stage_kind" = 'copy') or ` +
        `("stage_number" = 5 and "stage_kind" = 'crops')`,
      ),
    ),
    // The engine iterates this column. A non-array value would throw inside an
    // API request path, so the database refuses one.
    check("stage_states_consumed_is_array_check", sql`jsonb_typeof(${table.consumedFrom}) = 'array'`),
    // A locked stage must record when and by whom, so "locked" is never a
    // status with no provenance behind it.
    check(
      "stage_states_locked_provenance_check",
      sql`(${table.status} <> 'locked') or (${table.lockedAt} is not null)`,
    ),
  ],
);

export const stageTakesTable = pgTable(
  "stage_takes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    stageStateId: text("stage_state_id").notNull()
      .references(() => stageStatesTable.id, { onDelete: "cascade" }),
    /**
     * Which part of the stage this take belongs to: image, hook, caption,
     * hashtags, shot, motion, music, sfx, mix, voice, captions.
     *
     * Per-slot history is what makes re-rolling the image leave the caption
     * alone, which is the single most common source of lost work today.
     *
     * Deliberately NOT constrained to a fixed list: slots vary by medium and
     * new ones arrive with each phase, so a CHECK here would mean a migration
     * every time. The columns that describe the spine's shape are constrained;
     * this one describes its contents.
     */
    slotKey: text("slot_key").notNull(),
    takeIndex: integer("take_index").notNull(),
    origin: text("origin").$type<TakeOrigin>().notNull().default("generated"),
    /** Text, or {variantId}, or {audioUrl, ...} depending on the slot. */
    payload: jsonb("payload").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    authoredBy: text("authored_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** Cost at time of spend, so a later price change cannot rewrite history. */
    costCents: integer("cost_cents"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * Take numbering is read-max-then-write, so without this two concurrent
     * generations on the same slot both read max=2 and both write 3, silently
     * losing one take. This turns that race into a constraint violation the
     * caller can retry. It also supersedes a plain index on the same columns.
     */
    unique("stage_takes_slot_take_uq").on(table.stageStateId, table.slotKey, table.takeIndex),
    /**
     * At most one current take per slot, enforced rather than assumed. A
     * partial index is also a far better index for the "give me the current
     * take" read that every surface runs, than a plain index on a boolean.
     */
    uniqueIndex("stage_takes_one_current_per_slot_uq")
      .on(table.stageStateId, table.slotKey)
      .where(sql`${table.isCurrent}`),
    check("stage_takes_origin_check", oneOf("origin", TAKE_ORIGINS)),
    check("stage_takes_index_positive_check", sql`${table.takeIndex} >= 1`),
  ],
);

export const insertStageStateSchema = createInsertSchema(stageStatesTable, {
  // drizzle-zod infers jsonb as a permissive Json type, which would accept
  // null, an object, or a bare string at the API boundary. Narrow it.
  consumedFrom: z.array(z.string()),
  stageKind: z.enum(STAGE_KINDS),
  mode: z.enum(STAGE_MODES),
  status: z.enum(STAGE_STATUSES),
  stageNumber: z.int().min(1).max(5),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStageTakeSchema = createInsertSchema(stageTakesTable, {
  origin: z.enum(TAKE_ORIGINS),
  takeIndex: z.int().min(1),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertStageState = z.infer<typeof insertStageStateSchema>;
export type StageState = typeof stageStatesTable.$inferSelect;
export type InsertStageTake = z.infer<typeof insertStageTakeSchema>;
export type StageTake = typeof stageTakesTable.$inferSelect;
