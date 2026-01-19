-- Add foreign key constraint on agent_prompts_unified_link_table.agent_prompt_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_unified_link_table_agent_prompt_id') THEN
        ALTER TABLE "public"."agent_prompts_unified_link_table" ADD CONSTRAINT "fk_agent_prompts_unified_link_table_agent_prompt_id" FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint on lead_feedback_unified_link_table.lead_feedback_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_unified_link_table_lead_feedback_id') THEN
        ALTER TABLE "public"."lead_feedback_unified_link_table" ADD CONSTRAINT "fk_lead_feedback_unified_link_table_lead_feedback_id" FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint on leads_link_table_new.lead_id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_link_table_new_lead_id') THEN
        ALTER TABLE "public"."leads_link_table_new" ADD CONSTRAINT "fk_leads_link_table_new_lead_id" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Add foreign key constraint to agent_prompts_unified_link_table.agent_prompt_id (Duplicate check logic for safety)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompt_id') THEN
         ALTER TABLE agent_prompts_unified_link_table ADD CONSTRAINT fk_agent_prompt_id FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id);
    END IF;
END $$;

-- Add foreign key constraint to lead_feedback_unified_link_table.lead_feedback_id (Duplicate check logic for safety)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_id') THEN
        ALTER TABLE lead_feedback_unified_link_table ADD CONSTRAINT fk_lead_feedback_id FOREIGN KEY (lead_feedback_id) REFERENCES lead_feedback(id);
    END IF;
END $$;

-- Add foreign key constraint to leads_link_table_new.lead_id (Duplicate check logic for safety)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_id') THEN
        ALTER TABLE leads_link_table_new ADD CONSTRAINT fk_lead_id FOREIGN KEY (lead_id) REFERENCES leads(id);
    END IF;
END $$;

-- Create link tables to resolve multi-parent relationships for agent_prompts_unified_link and agent_prompts_unified_link_table
CREATE TABLE IF NOT EXISTS agent_prompts_link (id SERIAL PRIMARY KEY, agent_prompt_id UUID, parent_id UUID, parent_type VARCHAR); 

INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type) 
SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_unified_link
ON CONFLICT DO NOTHING;

INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type) 
SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_unified_link_table
ON CONFLICT DO NOTHING;

-- Create link tables to resolve multi-parent relationships for lead_feedback_unified_link and lead_feedback_unified_link_table
CREATE TABLE IF NOT EXISTS lead_feedback_link (id SERIAL PRIMARY KEY, lead_feedback_id UUID, parent_id UUID, parent_type VARCHAR); 

INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type) 
SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_unified_link
ON CONFLICT DO NOTHING;

INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type) 
SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_unified_link_table
ON CONFLICT DO NOTHING;

-- Create link tables to resolve multi-parent relationships for leads_link_table and leads_link_table_new
CREATE TABLE IF NOT EXISTS leads_link (id SERIAL PRIMARY KEY, lead_id UUID, parent_id UUID, parent_type VARCHAR); 

INSERT INTO leads_link (lead_id, parent_id, parent_type) 
SELECT lead_id, parent_id, parent_type FROM leads_link_table
ON CONFLICT DO NOTHING;

INSERT INTO leads_link (lead_id, parent_id, parent_type) 
SELECT lead_id, parent_id, parent_type FROM leads_link_table_new
ON CONFLICT DO NOTHING;
