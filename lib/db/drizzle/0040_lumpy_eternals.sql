CREATE TABLE "saved_run_brands" (
	"saved_run_id" text NOT NULL,
	"brand_id" text NOT NULL,
	CONSTRAINT "saved_run_brands_pk" PRIMARY KEY("saved_run_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "saved_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_creative_id" text,
	"locked_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_runs_name_present_check" CHECK (length(btrim("saved_runs"."name")) > 0),
	CONSTRAINT "saved_runs_locked_stages_is_array_check" CHECK (jsonb_typeof("saved_runs"."locked_stages") = 'array'),
	CONSTRAINT "saved_runs_snapshot_is_object_check" CHECK (jsonb_typeof("saved_runs"."template_snapshot") = 'object'),
	CONSTRAINT "saved_runs_run_count_check" CHECK ("saved_runs"."run_count" >= 0),
	CONSTRAINT "saved_runs_run_history_check" CHECK (("saved_runs"."run_count" > 0) = ("saved_runs"."last_run_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "saved_run_brands" ADD CONSTRAINT "saved_run_brands_saved_run_id_saved_runs_id_fk" FOREIGN KEY ("saved_run_id") REFERENCES "public"."saved_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_run_brands" ADD CONSTRAINT "saved_run_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_runs" ADD CONSTRAINT "saved_runs_source_creative_id_creatives_id_fk" FOREIGN KEY ("source_creative_id") REFERENCES "public"."creatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_runs" ADD CONSTRAINT "saved_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_run_brands_brand_idx" ON "saved_run_brands" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "saved_runs_created_idx" ON "saved_runs" USING btree ("created_at");--> statement-breakpoint
-- A saved run must have somewhere to run.
--
-- Doc 21 §3.7 encoded the cross-brand case as a null `brandId` on the run plus
-- rows in `saved_run_brands`. This schema drops that second encoding and makes
-- the target set the only place brands live, which removes the "null brand, no
-- targets" state entirely. What it cannot remove is a run inserted with no
-- target rows at all, because a CHECK cannot see another table.
--
-- A DEFERRED constraint trigger is the right tool rather than a BEFORE INSERT
-- one: the run and its targets are written in the same transaction, and their
-- order should not matter. The check happens at COMMIT, by which time both
-- inserts have landed.
--
-- The existence guard matters. A run can legitimately be deleted later in the
-- same transaction (see the cleanup trigger below), and a deferred check firing
-- against a row that is already gone must say nothing rather than complain
-- about a run nobody has any more.
CREATE OR REPLACE FUNCTION saved_runs_require_target()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM saved_runs WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM saved_run_brands WHERE saved_run_id = NEW.id) THEN
    RAISE EXCEPTION
      'a saved run needs at least one brand to run for (insert its saved_run_brands rows in the same transaction)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'saved_runs_require_target';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS saved_runs_require_target_trg ON saved_runs;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER saved_runs_require_target_trg
AFTER INSERT OR UPDATE ON saved_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION saved_runs_require_target();
--> statement-breakpoint
-- Deleting a brand must not be blocked by an old saved run.
--
-- `0037` is the lesson behind this one. There, a CHECK fired on a foreign key's
-- cascade and made deleting a library asset fail outright, with an error that
-- never mentioned sequences. The same shape was available here: guard the
-- target set with something that refuses, and deleting a brand starts failing
-- for reasons nobody can read.
--
-- So the cascade removes the target row, and if that was the run's last one the
-- run goes too. A saved run with no brand to run for is not a run somebody has
-- lost; it is a row that can no longer do anything. Removing a target through
-- the API is refused with a readable message BEFORE it reaches here, so in
-- practice this fires only on a brand deletion.
CREATE OR REPLACE FUNCTION saved_runs_drop_when_last_target_gone()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM saved_runs sr
  WHERE sr.id = OLD.saved_run_id
    AND NOT EXISTS (
      SELECT 1 FROM saved_run_brands srb WHERE srb.saved_run_id = OLD.saved_run_id
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS saved_run_brands_cleanup_trg ON saved_run_brands;
--> statement-breakpoint
CREATE TRIGGER saved_run_brands_cleanup_trg
AFTER DELETE ON saved_run_brands
FOR EACH ROW EXECUTE FUNCTION saved_runs_drop_when_last_target_gone();
