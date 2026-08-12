-- 0045 · a layer is a place.
--
-- Layer decomposition's first increment shipped the CAST: who is in a picture
-- and from which real file, read straight off the take. It could not say WHERE
-- anything was, and "where" is the entire point — Tony's ask is "change just
-- that one thing", which means a layer has to carry a region tight enough to
-- scope a generative edit to.
--
-- Only DETECTED rows live here. The cast is derived free from the take payload
-- at read time, and storing a copy of something derivable is how two sources of
-- truth start disagreeing. So this table holds exactly what a vision pass found
-- and could not have been known otherwise.
--
-- The box is normalised 0..1, never pixels, because it is handed to
-- services/region-edit.ts and that file's rule is normalised-or-nothing: a
-- region has to survive the same take being re-rendered at another size. The
-- CHECK enforces it rather than trusting the writer, for the reason region-edit
-- states out loud — a mask that means something other than what it says edits
-- pixels nobody selected, and the drift report cannot undo that.
--
-- Sets supersede rather than delete, like takes: re-detecting must not destroy
-- the decomposition somebody has been editing against.

CREATE TABLE "take_layers" (
  "id" text PRIMARY KEY NOT NULL,
  "stage_take_id" text NOT NULL,
  "layer_index" integer NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "origin" text DEFAULT 'detected' NOT NULL,
  "asset_id" text,
  "bbox" jsonb NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_stage_take_id_stage_takes_id_fk"
  FOREIGN KEY ("stage_take_id") REFERENCES "public"."stage_takes"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_asset_id_assets_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One row per position per take within the CURRENT set. Detection writes a whole
-- set in one transaction, so this turns a double-run into a constraint
-- violation rather than two interleaved decompositions of the same picture.
CREATE UNIQUE INDEX "take_layers_current_position_uq"
  ON "take_layers" USING btree ("stage_take_id","layer_index")
  WHERE "take_layers"."is_current";--> statement-breakpoint

CREATE INDEX "take_layers_take_idx" ON "take_layers" USING btree ("stage_take_id");--> statement-breakpoint

ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_kind_check"
  CHECK ("kind" in ('background', 'character', 'mark', 'typography', 'device', 'element'));--> statement-breakpoint

ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_origin_check"
  CHECK ("origin" in ('detected', 'user_named'));--> statement-breakpoint

-- 1-based, matching stage_takes.take_index — whose 0-based mistake once rolled
-- back a paid clip. One convention across the schema.
ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_index_positive_check"
  CHECK ("layer_index" >= 1);--> statement-breakpoint

-- A usable region or nothing. The 1.0001 slack absorbs the rounding of a
-- 0..1000 integer box divided into fractions; it does not admit a box that is
-- meaningfully outside the frame.
ALTER TABLE "take_layers" ADD CONSTRAINT "take_layers_bbox_in_frame_check"
  CHECK (("bbox"->>'x')::numeric >= 0 AND ("bbox"->>'y')::numeric >= 0
     AND ("bbox"->>'w')::numeric > 0 AND ("bbox"->>'h')::numeric > 0
     AND ("bbox"->>'x')::numeric + ("bbox"->>'w')::numeric <= 1.0001
     AND ("bbox"->>'y')::numeric + ("bbox"->>'h')::numeric <= 1.0001);
