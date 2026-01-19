-- Consolidate workflow_runs: Merge _new back into the original clean table name
INSERT INTO workflow_runs_link_table (workflow_run_id, parent_id, parent_type) 
SELECT workflow_run_id, parent_id, parent_type FROM workflow_runs_link_table_new 
ON CONFLICT DO NOTHING;

-- Ensure constraints exist on the final table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_link_table_workflow_run_id') THEN
        ALTER TABLE "public"."workflow_runs_link_table" ADD CONSTRAINT "fk_workflow_runs_link_table_workflow_run_id" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Drop the _new table
DROP TABLE IF EXISTS workflow_runs_link_table_new;

-- Other requested consolidations (agent_prompts_link_table, lead_feedback_parents, leads_parents) 
-- are skipped because checks confirmed they have already been dropped.
