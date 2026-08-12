import { pgTable, text, integer, real, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativesTable, creativeVariantsTable } from "./creatives";
import { assetsTable } from "./assets";
import { stageTakesTable } from "./stages";

/** Small helper mirroring the one used by the stages schema. */
const oneOf = (column: string, values: readonly string[]): ReturnType<typeof sql> =>
  sql.raw(`"${column}" IN (${values.map(v => `'${v}'`).join(", ")})`);

/**
 * Phase 9 · M7 · multi-clip video and the mixer.
 *
 * Doc 21 §3.3 and §3.4, and its own instruction that M7 "must ship with the
 * mixer, not before" — a table nobody writes is how M4 ended up with six dead
 * columns, so these arrive with the code that uses them.
 *
 * Tony's own observation is the reason this exists at all: one shot is the
 * special case, not the normal one (doc 24 §3).
 */

/**
 * "studio_take" (0043): a clip whose video is a Studio v2 stage take (payload
 * {videoUrl, sourceImageUrl, ...}), not a creative_variant. Real lineage is
 * the point — cut staleness reads which take a clip came from.
 */
export type ClipSourceKind = "generated" | "library_asset" | "upload" | "studio_take";
export const CLIP_SOURCE_KINDS = ["generated", "library_asset", "upload", "studio_take"] as const;

export type ClipTransition = "cut" | "dissolve";
export const CLIP_TRANSITIONS = ["cut", "dissolve"] as const;

export type TrackKind = "voice" | "music" | "sfx" | "native";
export const TRACK_KINDS = ["voice", "music", "sfx", "native"] as const;

export type TrackSource =
  | "elevenlabs_tts" | "elevenlabs_music" | "elevenlabs_sfx" | "veo_native" | "upload";
export const TRACK_SOURCES = [
  "elevenlabs_tts", "elevenlabs_music", "elevenlabs_sfx", "veo_native", "upload",
] as const;

export type RenderStatus = "draft" | "rendering" | "rendered" | "failed";
export const RENDER_STATUSES = ["draft", "rendering", "rendered", "failed"] as const;

export const sequencesTable = pgTable("sequences", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").notNull()
    .references(() => creativesTable.id, { onDelete: "cascade" }),
  /** The variant this sequence renders into, once it has rendered. Nullable. */
  variantId: text("variant_id").references(() => creativeVariantsTable.id, { onDelete: "set null" }),
  totalDurationMs: integer("total_duration_ms"),
  renderedUrl: text("rendered_url"),
  renderStatus: text("render_status").$type<RenderStatus>().notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("sequences_creative_idx").on(table.creativeId),
  check("sequences_render_status_check", oneOf("render_status", RENDER_STATUSES)),
  /**
   * A sequence that says it rendered has to have something to show for it.
   *
   * Same class of defect as a clip pointing at nothing: a row asserting a state
   * it cannot back up. Without this, `renderStatus` could read `rendered` with
   * a null `renderedUrl`, and every surface downstream would offer a video that
   * does not exist. `totalDurationMs` is required too, because a rendered
   * sequence whose length is unknown cannot be scheduled or fitted to a
   * voiceover.
   */
  check(
    "sequences_rendered_has_output_check",
    sql`render_status <> 'rendered'
        OR (rendered_url IS NOT NULL AND total_duration_ms IS NOT NULL)`,
  ),
]);

export const sequenceClipsTable = pgTable("sequence_clips", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sequenceId: text("sequence_id").notNull()
    .references(() => sequencesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  sourceKind: text("source_kind").$type<ClipSourceKind>().notNull(),
  /** Set when the clip was generated in-session. */
  sourceVariantId: text("source_variant_id")
    .references(() => creativeVariantsTable.id, { onDelete: "set null" }),
  /** Set when the clip came from the asset library. */
  sourceAssetId: text("source_asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
  /** Set when the clip is a Studio v2 take (its payload carries the videoUrl). */
  sourceTakeId: text("source_take_id").references(() => stageTakesTable.id, { onDelete: "set null" }),
  /** Set when the clip was uploaded. */
  uploadUrl: text("upload_url"),
  trimStartMs: integer("trim_start_ms").notNull().default(0),
  trimEndMs: integer("trim_end_ms").notNull(),
  transitionIn: text("transition_in").$type<ClipTransition>().notNull().default("cut"),
  /**
   * Set when the thing this clip pointed at was deleted underneath it.
   *
   * **The decision this column records.** Before it, the CHECK below fired on
   * the foreign key's SET NULL, so deleting a library asset that any sequence
   * used FAILED with a raw constraint error that never mentioned sequences.
   * Nothing was lost, but library hygiene was hostage to an old sequence and
   * the message told nobody why.
   *
   * The three options were: refuse the delete (what happened, accidentally),
   * cascade the clip away (silent loss of somebody's edit, and the sequence's
   * duration changes underneath them), or keep the row and mark it. This is the
   * third. The clip keeps its position and its trim, because that is the
   * human's work and §2.4 says keep it safe; the timeline says the source is
   * gone; the render refuses until somebody replaces or removes it.
   *
   * Stamped by a trigger rather than by application code, because the SET NULL
   * is what causes it and no caller is in the loop when a cascade fires.
   */
  sourceMissingAt: timestamp("source_missing_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  /**
   * Position is the entire ordering model. Doc 21: "Position plus trim is the
   * entire model; Principle 1.16 forbids the rest." The unique constraint is
   * what stops a reorder that half-applied from leaving two clips claiming the
   * same slot, which is a state no UI can render honestly.
   */
  unique("sequence_clips_position_uq").on(table.sequenceId, table.position),
  check("sequence_clips_source_kind_check", oneOf("source_kind", CLIP_SOURCE_KINDS)),
  check("sequence_clips_transition_check", oneOf("transition_in", CLIP_TRANSITIONS)),
  /**
   * A clip must actually point at something, and at the thing its kind claims.
   * Three source kinds with three nullable columns is exactly the shape where a
   * row ends up pointing nowhere, or pointing somewhere its kind says it does
   * not. Enforced here rather than trusted to every writer.
   */
  /*
   * A clip points at the thing its kind claims, OR it is explicitly marked as
   * having lost it. The second branch is what lets a source be deleted without
   * either refusing the delete or destroying somebody's edit, and it is
   * deliberately narrow: a row may only lack a pointer while it is ALSO
   * admitting to it. A silent null is still impossible.
   */
  check(
    "sequence_clips_source_present_check",
    sql`(source_kind = 'generated'     AND source_variant_id IS NOT NULL)
     OR (source_kind = 'library_asset' AND source_asset_id   IS NOT NULL)
     OR (source_kind = 'upload'        AND upload_url        IS NOT NULL)
     OR (source_kind = 'studio_take'   AND source_take_id    IS NOT NULL)
     OR source_missing_at IS NOT NULL`,
  ),
  /** A clip that ends before it starts is not a short clip, it is a broken one. */
  check("sequence_clips_trim_order_check", sql`trim_end_ms > trim_start_ms`),
  check("sequence_clips_trim_start_check", sql`trim_start_ms >= 0`),
]);

export const audioTracksTable = pgTable("audio_tracks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Exactly one of these two. A track belongs to a sequence or to one variant. */
  sequenceId: text("sequence_id").references(() => sequencesTable.id, { onDelete: "cascade" }),
  variantId: text("variant_id").references(() => creativeVariantsTable.id, { onDelete: "cascade" }),
  trackKind: text("track_kind").$type<TrackKind>().notNull(),
  source: text("source").$type<TrackSource>().notNull(),
  audioUrl: text("audio_url"),
  startMs: integer("start_ms").notNull().default(0),
  durationMs: integer("duration_ms"),
  gainDb: real("gain_db").notNull().default(0),
  /**
   * The track kind that ducks this one, usually "voice".
   *
   * Doc 21: "sidechain ducking as data rather than a render-time guess." That
   * phrasing is load-bearing. Because the ducking track's own `startMs` and
   * `durationMs` are known, the duck is a SCHEDULED gain envelope, not a
   * compressor listening to a signal. The same rows therefore produce the same
   * mix every render, and the UI can draw the ducked region before anything is
   * rendered at all.
   */
  duckUnder: text("duck_under").$type<TrackKind>(),
  duckAmountDb: real("duck_amount_db").default(-12),
  /** The VO script this was spoken from, so a re-record can find its words. */
  scriptTakeId: text("script_take_id").references(() => stageTakesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("audio_tracks_sequence_idx").on(table.sequenceId),
  index("audio_tracks_variant_idx").on(table.variantId),
  check("audio_tracks_kind_check", oneOf("track_kind", TRACK_KINDS)),
  check("audio_tracks_source_check", oneOf("source", TRACK_SOURCES)),
  check("audio_tracks_duck_under_check", sql`duck_under IS NULL OR ${oneOf("duck_under", TRACK_KINDS)}`),
  /**
   * A track hangs off a sequence or off a variant, never both and never
   * neither. Both would make "which mix is this in" unanswerable; neither is an
   * orphan that renders into nothing.
   */
  check(
    "audio_tracks_owner_check",
    sql`(sequence_id IS NOT NULL AND variant_id IS NULL)
     OR (sequence_id IS NULL AND variant_id IS NOT NULL)`,
  ),
  check("audio_tracks_start_check", sql`start_ms >= 0`),
  /** A duck that raises the volume is a bug wearing a minus sign the wrong way. */
  check("audio_tracks_duck_amount_check", sql`duck_amount_db IS NULL OR duck_amount_db <= 0`),
]);

export const insertSequenceSchema = createInsertSchema(sequencesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertSequenceClipSchema = createInsertSchema(sequenceClipsTable, {
  position: z.int().min(0),
  sourceKind: z.enum(CLIP_SOURCE_KINDS),
  transitionIn: z.enum(CLIP_TRANSITIONS),
}).omit({ id: true, createdAt: true });
export const insertAudioTrackSchema = createInsertSchema(audioTracksTable, {
  trackKind: z.enum(TRACK_KINDS),
  source: z.enum(TRACK_SOURCES),
}).omit({ id: true, createdAt: true });

export type Sequence = typeof sequencesTable.$inferSelect;
export type SequenceClip = typeof sequenceClipsTable.$inferSelect;
export type AudioTrack = typeof audioTracksTable.$inferSelect;
export type InsertSequence = z.infer<typeof insertSequenceSchema>;
export type InsertSequenceClip = z.infer<typeof insertSequenceClipSchema>;
export type InsertAudioTrack = z.infer<typeof insertAudioTrackSchema>;
