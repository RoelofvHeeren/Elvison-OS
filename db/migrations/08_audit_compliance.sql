-- Audit Compliance Refinement (08_audit_compliance.sql)
-- Rename existing link tables to match audit requirements and ensure all FKs are UUID based.

DO $$ 
BEGIN
    -- 1. Rename Link Tables if they exist with the old names
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_prompts_link') THEN
        ALTER TABLE agent_prompts_link RENAME TO agent_prompts_link_table;
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_feedback_link') THEN
        ALTER TABLE lead_feedback_link RENAME TO lead_feedback_link_table;
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leads_link') THEN
        ALTER TABLE leads_link RENAME TO leads_link_table;
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workflow_runs_link') THEN
        ALTER TABLE workflow_runs_link RENAME TO workflow_runs_link_table;
    END IF;

    -- 2. Create tables if they didn't exist at all
    CREATE TABLE IF NOT EXISTS agent_prompts_link_table (id SERIAL PRIMARY KEY, agent_prompt_id UUID NOT NULL, FOREIGN KEY (agent_prompt_id) REFERENCES agent_prompts(id));
    CREATE TABLE IF NOT EXISTS lead_feedback_link_table (id SERIAL PRIMARY KEY, lead_feedback_id UUID NOT NULL, FOREIGN KEY (lead_feedback_id) REFERENCES lead_feedback(id));
    CREATE TABLE IF NOT EXISTS leads_link_table (id SERIAL PRIMARY KEY, lead_id UUID NOT NULL, FOREIGN KEY (lead_id) REFERENCES leads(id));
    CREATE TABLE IF NOT EXISTS workflow_runs_link_table (id SERIAL PRIMARY KEY, workflow_run_id UUID NOT NULL, FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id));

    -- 3. Ensure FK Constraints match the Audit's requested names (Specific naming requirements)
    -- Using UUIDs for all references.

    -- agent_prompts -> users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_user_id') THEN
        ALTER TABLE "public"."agent_prompts" ADD CONSTRAINT "fk_agent_prompts_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;

    -- agent_prompts_link_table -> agent_prompts
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_link_agent_prompt_id') THEN
        ALTER TABLE "public"."agent_prompts_link_table" ADD CONSTRAINT "fk_agent_prompts_link_agent_prompt_id" FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE SET NULL;
    END IF;

    -- lead_feedback -> leads
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_lead_id') THEN
        ALTER TABLE "public"."lead_feedback" ADD CONSTRAINT "fk_lead_feedback_lead_id" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;
    END IF;

    -- lead_feedback -> users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_user_id') THEN
        ALTER TABLE "public"."lead_feedback" ADD CONSTRAINT "fk_lead_feedback_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;

    -- lead_feedback_link_table -> lead_feedback
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_link_lead_feedback_id') THEN
        ALTER TABLE "public"."lead_feedback_link_table" ADD CONSTRAINT "fk_lead_feedback_link_lead_feedback_id" FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE SET NULL;
    END IF;

    -- leads -> users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_user_id') THEN
        ALTER TABLE "public"."leads" ADD CONSTRAINT "fk_leads_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;

    -- leads -> icps
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_icp_id') THEN
        ALTER TABLE "public"."leads" ADD CONSTRAINT "fk_leads_icp_id" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE SET NULL;
    END IF;

    -- leads_link_table -> leads
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_link_lead_id') THEN
        ALTER TABLE "public"."leads_link_table" ADD CONSTRAINT "fk_leads_link_lead_id" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;
    END IF;

    -- workflow_runs -> users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_user_id') THEN
        ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "fk_workflow_runs_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;

    -- workflow_runs -> icps
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_icp_id') THEN
        ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "fk_workflow_runs_icp_id" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE SET NULL;
    END IF;

    -- workflow_runs_link_table -> workflow_runs
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_link_workflow_run_id') THEN
        ALTER TABLE "public"."workflow_runs_link_table" ADD CONSTRAINT "fk_workflow_runs_link_workflow_run_id" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE SET NULL;
    END IF;

END $$;
