-- Deduplicate link tables and add unique constraints to prevent future duplicates

-- 1. Agent Prompts Link
DELETE FROM agent_prompts_link 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM agent_prompts_link 
    GROUP BY agent_prompt_id, parent_id, parent_type
);

ALTER TABLE agent_prompts_link 
ADD CONSTRAINT uq_agent_prompts_link UNIQUE (agent_prompt_id, parent_id, parent_type);

-- 2. Lead Feedback Link
DELETE FROM lead_feedback_link 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM lead_feedback_link 
    GROUP BY lead_feedback_id, parent_id, parent_type
);

ALTER TABLE lead_feedback_link 
ADD CONSTRAINT uq_lead_feedback_link UNIQUE (lead_feedback_id, parent_id, parent_type);

-- 3. Leads Link
DELETE FROM leads_link 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM leads_link 
    GROUP BY lead_id, parent_id, parent_type
);

ALTER TABLE leads_link 
ADD CONSTRAINT uq_leads_link UNIQUE (lead_id, parent_id, parent_type);

-- 4. Workflow Runs Link Table
DELETE FROM workflow_runs_link_table 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM workflow_runs_link_table 
    GROUP BY workflow_run_id, parent_id, parent_type
);

ALTER TABLE workflow_runs_link_table 
ADD CONSTRAINT uq_workflow_runs_link_table UNIQUE (workflow_run_id, parent_id, parent_type);
