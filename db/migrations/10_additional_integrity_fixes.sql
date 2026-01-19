-- Migration 10: Additional Integrity Fixes (UUID-Compatible)
-- This migration adds missing foreign key constraints identified by the database audit
-- All constraints use UUID types to match the existing schema

-- Helper block for Foreign Keys
DO $$ 
BEGIN
    -- Link table constraints (these were missing from previous migrations)
    
    -- agent_prompts_link_table.agent_prompt_id (if table exists with _link_table suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_link_table') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_link_table_agent_prompt_id') THEN
            ALTER TABLE "public"."agent_prompts_link_table" 
            ADD CONSTRAINT "fk_agent_prompts_link_table_agent_prompt_id" 
            FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- agent_prompts_link.agent_prompt_id (if table exists with _link suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts_link') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_link_agent_prompt_id') THEN
            ALTER TABLE "public"."agent_prompts_link" 
            ADD CONSTRAINT "fk_agent_prompts_link_agent_prompt_id" 
            FOREIGN KEY ("agent_prompt_id") REFERENCES "public"."agent_prompts"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- lead_feedback_link_table.lead_feedback_id (if table exists with _link_table suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_link_table') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_link_table_lead_feedback_id') THEN
            ALTER TABLE "public"."lead_feedback_link_table" 
            ADD CONSTRAINT "fk_lead_feedback_link_table_lead_feedback_id" 
            FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- lead_feedback_link.lead_feedback_id (if table exists with _link suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback_link') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_link_lead_feedback_id') THEN
            ALTER TABLE "public"."lead_feedback_link" 
            ADD CONSTRAINT "fk_lead_feedback_link_lead_feedback_id" 
            FOREIGN KEY ("lead_feedback_id") REFERENCES "public"."lead_feedback"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- leads_link_table.lead_id (if table exists with _link_table suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads_link_table') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_link_table_lead_id') THEN
            ALTER TABLE "public"."leads_link_table" 
            ADD CONSTRAINT "fk_leads_link_table_lead_id" 
            FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- leads_link.lead_id (if table exists with _link suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads_link') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_link_lead_id') THEN
            ALTER TABLE "public"."leads_link" 
            ADD CONSTRAINT "fk_leads_link_lead_id" 
            FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- workflow_runs_link_table.workflow_run_id (if table exists with _link_table suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_runs_link_table') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_link_table_workflow_run_id') THEN
            ALTER TABLE "public"."workflow_runs_link_table" 
            ADD CONSTRAINT "fk_workflow_runs_link_table_workflow_run_id" 
            FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- workflow_runs_link.workflow_run_id (if table exists with _link suffix)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_runs_link') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_link_workflow_run_id') THEN
            ALTER TABLE "public"."workflow_runs_link" 
            ADD CONSTRAINT "fk_workflow_runs_link_workflow_run_id" 
            FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;
        END IF;
    END IF;

    -- Additional constraints that may be missing (these were in the audit but may already exist from 07_integrity_fixes.sql)
    -- We check for existence before adding to ensure idempotency
    
    -- Verify all user_id foreign keys exist (redundant check, but ensures completeness)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_prompts' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompts_user_id') THEN
            ALTER TABLE "public"."agent_prompts" 
            ADD CONSTRAINT "fk_agent_prompts_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_companies_user_id') THEN
            ALTER TABLE "public"."companies" 
            ADD CONSTRAINT "fk_companies_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_team_members' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_company_team_members_user_id') THEN
            ALTER TABLE "public"."company_team_members" 
            ADD CONSTRAINT "fk_company_team_members_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_columns' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_columns_user_id') THEN
            ALTER TABLE "public"."crm_columns" 
            ADD CONSTRAINT "fk_crm_columns_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'icps' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_icps_user_id') THEN
            ALTER TABLE "public"."icps" 
            ADD CONSTRAINT "fk_icps_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_feedback') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_feedback' AND column_name = 'lead_id') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_lead_id') THEN
                ALTER TABLE "public"."lead_feedback" 
                ADD CONSTRAINT "fk_lead_feedback_lead_id" 
                FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_feedback' AND column_name = 'user_id') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_feedback_user_id') THEN
                ALTER TABLE "public"."lead_feedback" 
                ADD CONSTRAINT "fk_lead_feedback_user_id" 
                FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_user_id') THEN
            ALTER TABLE "public"."leads" 
            ADD CONSTRAINT "fk_leads_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'icp_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_icp_id') THEN
            ALTER TABLE "public"."leads" 
            ADD CONSTRAINT "fk_leads_icp_id" 
            FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'researched_companies' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_researched_companies_user_id') THEN
            ALTER TABLE "public"."researched_companies" 
            ADD CONSTRAINT "fk_researched_companies_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'run_feedback' AND column_name = 'icp_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_run_feedback_icp_id') THEN
            ALTER TABLE "public"."run_feedback" 
            ADD CONSTRAINT "fk_run_feedback_icp_id" 
            FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_config') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_config' AND column_name = 'user_id') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_system_config_user_id') THEN
                ALTER TABLE "public"."system_config" 
                ADD CONSTRAINT "fk_system_config_user_id" 
                FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
            END IF;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workflow_runs' AND column_name = 'user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_user_id') THEN
            ALTER TABLE "public"."workflow_runs" 
            ADD CONSTRAINT "fk_workflow_runs_user_id" 
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workflow_runs' AND column_name = 'icp_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_runs_icp_id') THEN
            ALTER TABLE "public"."workflow_runs" 
            ADD CONSTRAINT "fk_workflow_runs_icp_id" 
            FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE SET NULL;
        END IF;
    END IF;

END $$;

SELECT 'Migration 10: Additional integrity constraints applied successfully!' AS result;
