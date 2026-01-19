-- Create a new link table for agent_prompts_unified_link to resolve multi-parent relationship.
CREATE TABLE IF NOT EXISTS agent_prompts_unified_link_table (id SERIAL PRIMARY KEY, agent_prompt_id UUID, parent_id UUID, parent_type VARCHAR); 
INSERT INTO agent_prompts_unified_link_table (agent_prompt_id, parent_id, parent_type) SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_unified_link ON CONFLICT DO NOTHING;

-- Create a new link table for lead_feedback_unified_link to resolve multi-parent relationship.
CREATE TABLE IF NOT EXISTS lead_feedback_unified_link_table (id SERIAL PRIMARY KEY, lead_feedback_id UUID, parent_id UUID, parent_type VARCHAR); 
INSERT INTO lead_feedback_unified_link_table (lead_feedback_id, parent_id, parent_type) SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_unified_link ON CONFLICT DO NOTHING;

-- Create a new link table for leads to resolve multi-parent relationship.
CREATE TABLE IF NOT EXISTS leads_link_table_new (id SERIAL PRIMARY KEY, lead_id UUID, parent_id UUID, parent_type VARCHAR); 
INSERT INTO leads_link_table_new (lead_id, parent_id, parent_type) SELECT lead_id, parent_id, parent_type FROM leads_link_table ON CONFLICT DO NOTHING;

-- Create a new link table for workflow_runs to resolve multi-parent relationship.
CREATE TABLE IF NOT EXISTS workflow_runs_link_table_new (id SERIAL PRIMARY KEY, workflow_run_id UUID, parent_id UUID, parent_type VARCHAR); 
INSERT INTO workflow_runs_link_table_new (workflow_run_id, parent_id, parent_type) SELECT workflow_run_id, parent_id, parent_type FROM workflow_runs_link_table ON CONFLICT DO NOTHING;
