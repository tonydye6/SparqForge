import { pgTable, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativesTable } from "./creatives";
import { stageStatesTable } from "./stages";
import { usersTable } from "./users";

/**
 * Migration M5 · the team.
 *
 * Spec: `SparqMake Sandbox/21_SPEC_01_DATA_MODEL.md` §3.6. Two new tables, no
 * change to anything that exists, reversible by drop.
 *
 * The whole phase turns on one sentence in the spec: **anchoring a comment to
 * `stageStateId` is what makes reopening stage 02 surface Chase's note again,
 * and `rejectStageStateId` is what turns the reject taxonomy into training
 * signal instead of a dropdown.**
 *
 * Both of those are about a note outliving the moment it was written. The seven
 * reject categories already exist, in `artifacts/sparqmake/src/lib/
 * reject-reasons.ts`, and today they are smuggled into a free-text field as
 * `[CATEGORY:off_brand] …` because there was nowhere to put them. The parser
 * that reads them back is the tell. A category that lives in a column can be
 * counted, charted and fed back; one that lives in a string prefix can only be
 * displayed.
 */

/**
 * The seven categories, moved from the client to here.
 *
 * They were frontend-only, so the server could not validate a decision and
 * nothing could aggregate them. This is now the one definition; the client
 * imports its labels from the API rather than keeping a second list that drifts.
 */
export const REJECT_REASONS = [
  "off_brand",
  "image_quality",
  "caption_issues",
  "headline_issues",
  "platform_mismatch",
  "trademark_violation",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const APPROVAL_DECISIONS = ["approved", "needs_work"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const oneOf = (col: string, values: readonly string[]) =>
  sql.raw(`"${col}" in (${values.map(v => `'${v}'`).join(", ")})`);

export const commentsTable = pgTable(
  "comments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    creativeId: text("creative_id").notNull()
      .references(() => creativesTable.id, { onDelete: "cascade" }),
    /**
     * The stage this note is about. Nullable, because a note about the whole
     * creative is a real thing and forcing it onto a stage would be a lie about
     * what someone meant.
     *
     * `set null` rather than `cascade`: if a stage row ever goes, the note
     * someone wrote should survive as a creative-level comment rather than be
     * deleted along with it.
     */
    stageStateId: text("stage_state_id")
      .references(() => stageStatesTable.id, { onDelete: "set null" }),
    /** Narrower still: the take slot it is about, e.g. "as_briefed__mid". */
    slotKey: text("slot_key"),
    authorId: text("author_id").notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("comments_creative_created_idx").on(table.creativeId, table.createdAt),
    // The resurfacing query is "what was said about this stage", so it gets its
    // own index rather than riding the creative one.
    index("comments_stage_idx").on(table.stageStateId),
    // An empty comment is not a comment. Enforced here because the thing that
    // makes a note worth resurfacing is that it says something.
    check("comments_body_not_blank_check", sql`length(btrim(${table.body})) > 0`),
    // Resolved means resolved BY someone. Half a resolution is how a note
    // silently stops resurfacing with nobody accountable for that.
    check(
      "comments_resolved_provenance_check",
      sql`(${table.resolvedAt} is null) = (${table.resolvedBy} is null)`,
    ),
  ],
);

export const approvalsTable = pgTable(
  "approvals",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    creativeId: text("creative_id").notNull()
      .references(() => creativesTable.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    decidedBy: text("decided_by").references(() => usersTable.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    decision: text("decision").$type<ApprovalDecision>(),
    /** One of the seven, and only when the decision is needs_work. */
    rejectReason: text("reject_reason").$type<RejectReason>(),
    /**
     * The stage that caused it. THE column of this phase.
     *
     * Without it "off-brand" is a word in a dropdown. With it, the note lands
     * on stage 02 and is waiting there when someone reopens it, and the same
     * rows can later answer "which stage do we send back most often", which is
     * a question about the product rather than about one post.
     */
    rejectStageStateId: text("reject_stage_state_id")
      .references(() => stageStatesTable.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("approvals_creative_requested_idx").on(table.creativeId, table.requestedAt),
    check("approvals_decision_check", sql`${table.decision} is null or ${oneOf("decision", APPROVAL_DECISIONS)}`),
    check("approvals_reason_check", sql`${table.rejectReason} is null or ${oneOf("reject_reason", REJECT_REASONS)}`),
    /*
     * A decision is all three or none of them. A row with `decidedAt` and no
     * `decision` is a request that looks answered and is not, and this project
     * has already been bitten once by a status whose provenance was optional
     * (`stage_states_locked_provenance_check` exists for the same reason).
     */
    check(
      "approvals_decided_together_check",
      sql`(${table.decidedAt} is null and ${table.decision} is null and ${table.decidedBy} is null)
          or (${table.decidedAt} is not null and ${table.decision} is not null and ${table.decidedBy} is not null)`,
    ),
    /*
     * A reason belongs to a rejection. Recording "off_brand" beside an approval
     * would poison the very aggregation `rejectStageStateId` exists to enable.
     */
    check(
      "approvals_reason_only_on_needs_work_check",
      sql`(${table.rejectReason} is null and ${table.rejectStageStateId} is null)
          or ${table.decision} = 'needs_work'`,
    ),
    /*
     * needs_work must say why. "Send it back" with no category is the state the
     * old Review Queue was in, where the server stripped the comment and the
     * person who had to fix it learned nothing.
     */
    check(
      "approvals_needs_work_has_reason_check",
      sql`${table.decision} <> 'needs_work' or ${table.rejectReason} is not null`,
    ),
  ],
);

export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  id: true, createdAt: true, resolvedAt: true, resolvedBy: true,
});
export const insertApprovalSchema = createInsertSchema(approvalsTable).omit({
  id: true, createdAt: true, requestedAt: true,
});

export type Comment = typeof commentsTable.$inferSelect;
export type Approval = typeof approvalsTable.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
