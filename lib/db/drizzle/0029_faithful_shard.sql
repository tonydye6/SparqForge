CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"decision" text,
	"reject_reason" text,
	"reject_stage_state_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_decision_check" CHECK ("approvals"."decision" is null or "decision" in ('approved', 'needs_work')),
	CONSTRAINT "approvals_reason_check" CHECK ("approvals"."reject_reason" is null or "reject_reason" in ('off_brand', 'image_quality', 'caption_issues', 'headline_issues', 'platform_mismatch', 'trademark_violation', 'other')),
	CONSTRAINT "approvals_decided_together_check" CHECK (("approvals"."decided_at" is null and "approvals"."decision" is null and "approvals"."decided_by" is null)
          or ("approvals"."decided_at" is not null and "approvals"."decision" is not null and "approvals"."decided_by" is not null)),
	CONSTRAINT "approvals_reason_only_on_needs_work_check" CHECK (("approvals"."reject_reason" is null and "approvals"."reject_stage_state_id" is null)
          or "approvals"."decision" = 'needs_work'),
	CONSTRAINT "approvals_needs_work_has_reason_check" CHECK ("approvals"."decision" <> 'needs_work' or "approvals"."reject_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"stage_state_id" text,
	"slot_key" text,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_blank_check" CHECK (length(btrim("comments"."body")) > 0),
	CONSTRAINT "comments_resolved_provenance_check" CHECK (("comments"."resolved_at" is null) = ("comments"."resolved_by" is null))
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reject_stage_state_id_stage_states_id_fk" FOREIGN KEY ("reject_stage_state_id") REFERENCES "public"."stage_states"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_stage_state_id_stage_states_id_fk" FOREIGN KEY ("stage_state_id") REFERENCES "public"."stage_states"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_creative_requested_idx" ON "approvals" USING btree ("creative_id","requested_at");--> statement-breakpoint
CREATE INDEX "comments_creative_created_idx" ON "comments" USING btree ("creative_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_stage_idx" ON "comments" USING btree ("stage_state_id");