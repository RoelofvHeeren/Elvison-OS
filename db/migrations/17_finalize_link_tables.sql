-- Add foreign key constraint on agent_prompts_link.agent_prompt_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_link_agent_prompt_id') THEN
        ALTER TABLE "public"."agent_prompts_link" ADD CONSTRAINT "fk_agent_prompts_link_agent_prompt_id" FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint on lead_feedback_link.lead_feedback_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_link_lead_feedback_id') THEN
        ALTER TABLE "public"."lead_feedback_link" ADD CONSTRAINT "fk_lead_feedback_link_lead_feedback_id" FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint on leads_link.lead_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_link_lead_id') THEN
        ALTER TABLE "public"."leads_link" ADD CONSTRAINT "fk_leads_link_lead_id" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint on workflow_runs_link_table_new.workflow_run_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_link_table_new_workflow_run_id') THEN
        ALTER TABLE "public"."workflow_runs_link_table_new" ADD CONSTRAINT "fk_workflow_runs_link_table_new_workflow_run_id" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Consolidate agent_prompts tables
-- Insert missing data if any (though likely migrated in step 16)
INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type) 
SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_unified_link 
ON CONFLICT DO NOTHING;

INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type) 
SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_unified_link_table 
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS agent_prompts_unified_link;
DROP TABLE IF EXISTS agent_prompts_unified_link_table;

-- Consolidate lead_feedback tables
INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type) 
SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_unified_link 
ON CONFLICT DO NOTHING;

INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type) 
SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_unified_link_table 
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS lead_feedback_unified_link;
DROP TABLE IF EXISTS lead_feedback_unified_link_table;

-- Consolidate leads tables
INSERT INTO leads_link (lead_id, parent_id, parent_type) 
SELECT lead_id, parent_id, parent_type FROM leads_link_table 
ON CONFLICT DO NOTHING;

INSERT INTO leads_link (lead_id, parent_id, parent_type) 
SELECT lead_id, parent_id, parent_type FROM leads_link_table_new 
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS leads_link_table;
DROP TABLE IF EXISTS leads_link_table_new;

-- Add simple named constraints if they don't exist (User request had duplicate checks with simple names)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompt_id') THEN
         ALTER TABLE agent_prompts_link ADD CONSTRAINT fk_agent_prompt_id FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_id') THEN
        ALTER TABLE lead_feedback_link ADD CONSTRAINT fk_lead_feedback_id FOREIGN KEY (lead_feedback_id) REFERENCES lead_feedback(id);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_id') THEN
        ALTER TABLE leads_link ADD CONSTRAINT fk_lead_id FOREIGN KEY (lead_id) REFERENCES leads(id);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_run_id') THEN
        ALTER TABLE workflow_runs_link_table_new ADD CONSTRAINT fk_workflow_run_id FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id);
    END IF;
END $$;
