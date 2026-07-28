import { pgTable, text, timestamp, integer, boolean, jsonb, index, unique } from "drizzle-orm/pg-core";
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
 */

/** The five fixed stages. A sixth is a product decision, never a user action. */
export const STAGE_KINDS = ["brief", "direction", "asset", "copy", "crops"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/** Canonical order. Index + 1 is the stageNumber. */
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

export const stageStatesTable = pgTable(
  "stage_states",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    creativeId: text("creative_id").notNull()
      .references(() => creativesTable.id, { onDelete: "cascade" }),
    // 1..5. A reading convention, not a dependency.
    stageNumber: integer("stage_number").notNull(),
    stageKind: text("stage_kind").notNull(),
    mode: text("mode").notNull().default("explore"),
    status: text("status").notNull().default("empty"),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by").references(() => usersTable.id, { onDelete: "set null" }),
    /**
     * Ids of the stage_states rows this stage actually consumed. THE dependency
     * graph. An empty array means nothing can stale this stage, which is
     * exactly the case for copy authored before an image existed.
     */
    consumedFrom: jsonb("consumed_from").notNull().default([]),
    decidedAt: timestamp("decided_at"),
    /** Why this went stale, so the UI can say it rather than just colour it. */
    supersededReason: text("superseded_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One row per stage per creative. The spine has a fixed shape.
    unique("stage_states_creative_stage_uq").on(table.creativeId, table.stageNumber),
    index("stage_states_creative_idx").on(table.creativeId, table.stageNumber),
    index("stage_states_status_idx").on(table.status),
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
     */
    slotKey: text("slot_key").notNull(),
    takeIndex: integer("take_index").notNull(),
    origin: text("origin").notNull().default("generated"),
    /** Text, or {variantId}, or {audioUrl, ...} depending on the slot. */
    payload: jsonb("payload").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    authoredBy: text("authored_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** Cost at time of spend, so a later price change cannot rewrite history. */
    costCents: integer("cost_cents"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("stage_takes_slot_idx").on(table.stageStateId, table.slotKey, table.takeIndex),
    index("stage_takes_current_idx").on(table.stageStateId, table.isCurrent),
  ],
);

export const insertStageStateSchema = createInsertSchema(stageStatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStageTakeSchema = createInsertSchema(stageTakesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertStageState = z.infer<typeof insertStageStateSchema>;
export type StageState = typeof stageStatesTable.$inferSelect;
export type InsertStageTake = z.infer<typeof insertStageTakeSchema>;
export type StageTake = typeof stageTakesTable.$inferSelect;
