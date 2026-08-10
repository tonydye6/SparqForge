ALTER TABLE "sequences" ADD CONSTRAINT "sequences_rendered_has_output_check" CHECK (render_status <> 'rendered'
        OR (rendered_url IS NOT NULL AND total_duration_ms IS NOT NULL));