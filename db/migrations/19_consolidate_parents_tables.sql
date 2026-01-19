-- Adaptive migration: Only run consolidation if source tables exist.

DO $$ 
BEGIN
    -- 1. Agent Prompts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_parents') THEN
        INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type) 
        SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_parents 
        ON CONFLICT DO NOTHING;
        
        DROP TABLE agent_prompts_parents;
    END IF;

    -- 2. Lead Feedback
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_parents') THEN
        INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type) 
        SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_parents 
        ON CONFLICT DO NOTHING;
        
        DROP TABLE lead_feedback_parents;
    END IF;

    -- 3. Leads
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads_parents') THEN
        INSERT INTO leads_link (lead_id, parent_id, parent_type) 
        SELECT lead_id, parent_id, parent_type FROM leads_parents 
        ON CONFLICT DO NOTHING;
        
        DROP TABLE leads_parents;
    END IF;

    -- 4. Workflow Runs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_runs_parents') THEN
        INSERT INTO workflow_runs_link_table (workflow_run_id, parent_id, parent_type) 
        SELECT workflow_run_id, parent_id, parent_type FROM workflow_runs_parents 
        ON CONFLICT DO NOTHING;
        
        DROP TABLE workflow_runs_parents;
    END IF;
END $$;
