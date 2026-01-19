-- Add foreign key constraint on agent_prompts_parents.agent_prompt_id
ALTER TABLE "public"."agent_prompts_parents" ADD CONSTRAINT "fk_agent_prompts_parents_agent_prompt_id" FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE SET NULL;

-- Add foreign key constraint on lead_feedback_parents.lead_feedback_id
ALTER TABLE "public"."lead_feedback_parents" ADD CONSTRAINT "fk_lead_feedback_parents_lead_feedback_id" FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE SET NULL;

-- Add foreign key constraint on leads_parents.lead_id
ALTER TABLE "public"."leads_parents" ADD CONSTRAINT "fk_leads_parents_lead_id" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;

-- Add foreign key constraint to agent_prompts_parents.agent_prompt_id referencing agent_prompts.id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompt_id') THEN
        ALTER TABLE agent_prompts_parents ADD CONSTRAINT fk_agent_prompt_id FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id);
    END IF;
END $$;

-- Add foreign key constraint to lead_feedback_parents.lead_feedback_id referencing lead_feedback.id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_id') THEN
        ALTER TABLE lead_feedback_parents ADD CONSTRAINT fk_lead_feedback_id FOREIGN KEY (lead_feedback_id) REFERENCES lead_feedback(id);
    END IF;
END $$;

-- Add foreign key constraint to leads_parents.lead_id referencing leads.id
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_id') THEN
        ALTER TABLE leads_parents ADD CONSTRAINT fk_lead_id FOREIGN KEY (lead_id) REFERENCES leads(id);
    END IF;
END $$;

-- Create a unified link table for agent_prompts to resolve multi-parent relationships
CREATE TABLE IF NOT EXISTS agent_prompts_unified_link (
    id SERIAL PRIMARY KEY, 
    agent_prompt_id UUID NOT NULL, 
    parent_id UUID NOT NULL, 
    parent_type VARCHAR NOT NULL, 
    CONSTRAINT fk_agent_prompt_id FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id)
);

-- Migrate data from agent_prompts_link, agent_prompts_link_table, and agent_prompts_parents to agent_prompts_unified_link
DO $$
BEGIN
    -- Migrate from agent_prompts_link if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_link') THEN
        INSERT INTO agent_prompts_unified_link (agent_prompt_id, parent_id, parent_type) 
        SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_link
        ON CONFLICT DO NOTHING;
    END IF;

    -- Migrate from agent_prompts_link_table if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_link_table') THEN
        INSERT INTO agent_prompts_unified_link (agent_prompt_id, parent_id, parent_type) 
        SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_link_table
        ON CONFLICT DO NOTHING;
    END IF;

    -- Migrate from agent_prompts_parents if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_parents') THEN
        INSERT INTO agent_prompts_unified_link (agent_prompt_id, parent_id, parent_type) 
        SELECT agent_prompt_id, parent_id, parent_type FROM agent_prompts_parents
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- Create a unified link table for lead_feedback to resolve multi-parent relationships
CREATE TABLE IF NOT EXISTS lead_feedback_unified_link (
    id SERIAL PRIMARY KEY, 
    lead_feedback_id UUID NOT NULL, 
    parent_id UUID NOT NULL, 
    parent_type VARCHAR NOT NULL, 
    CONSTRAINT fk_lead_feedback_id FOREIGN KEY (lead_feedback_id) REFERENCES lead_feedback(id)
);

-- Migrate data from lead_feedback_link, lead_feedback_link_table, and lead_feedback_parents to lead_feedback_unified_link
DO $$
BEGIN
    -- Migrate from lead_feedback_link if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_link') THEN
        INSERT INTO lead_feedback_unified_link (lead_feedback_id, parent_id, parent_type) 
        SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_link
        ON CONFLICT DO NOTHING;
    END IF;

    -- Migrate from lead_feedback_link_table if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_link_table') THEN
        INSERT INTO lead_feedback_unified_link (lead_feedback_id, parent_id, parent_type) 
        SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_link_table
        ON CONFLICT DO NOTHING;
    END IF;

    -- Migrate from lead_feedback_parents if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_parents') THEN
        INSERT INTO lead_feedback_unified_link (lead_feedback_id, parent_id, parent_type) 
        SELECT lead_feedback_id, parent_id, parent_type FROM lead_feedback_parents
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
