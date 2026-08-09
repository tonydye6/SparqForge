ALTER TABLE "cost_logs" ADD COLUMN "stage_take_id" text;--> statement-breakpoint
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_stage_take_id_stage_takes_id_fk" FOREIGN KEY ("stage_take_id") REFERENCES "public"."stage_takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_logs_stage_take_idx" ON "cost_logs" USING btree ("stage_take_id");