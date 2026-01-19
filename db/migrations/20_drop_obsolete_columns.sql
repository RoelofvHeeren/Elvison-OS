-- Drop obsolete columns that cause Multi-Parent Divergence Risks
-- These relationships are now handled exclusively by the _link tables.

-- 1. Leads
ALTER TABLE "public"."leads" DROP COLUMN IF EXISTS "icp_id";
ALTER TABLE "public"."leads" DROP COLUMN IF EXISTS "run_id";

-- 2. Workflow Runs
ALTER TABLE "public"."workflow_runs" DROP COLUMN IF EXISTS "agent_id";
ALTER TABLE "public"."workflow_runs" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "public"."workflow_runs" DROP COLUMN IF EXISTS "icp_id";

-- 3. Agent Prompts (Safeguard)
ALTER TABLE "public"."agent_prompts" DROP COLUMN IF EXISTS "parent_id";

-- 4. Lead Feedback (Safeguard)
ALTER TABLE "public"."lead_feedback" DROP COLUMN IF EXISTS "parent_id";
