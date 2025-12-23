-- Multi-User Migration
-- Adds user authentication and per-user data isolation

-- Step 1: Update users table with required columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_state JSONB DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Step 2: Create owner account (using environment variable or default)
-- Note: Password will be set on first login via password reset flow
INSERT INTO users (email, name, role, password_hash, onboarding_completed, credits)
VALUES (
    COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai'),
    COALESCE(NULLIF(current_setting('app.owner_name', true), ''), 'System Owner'),
    'admin',
    NULL, -- Will be set on first login
    TRUE,
    500000
)
ON CONFLICT (email) DO UPDATE 
SET onboarding_completed = TRUE
RETURNING id;

-- Step 3: Add user_id columns to all data tables
ALTER TABLE agent_prompts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE crm_columns ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Step 4: Migrate existing data to owner account
UPDATE agent_prompts 
SET user_id = (SELECT id FROM users WHERE email = COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai'))
WHERE user_id IS NULL;

UPDATE leads 
SET user_id = (SELECT id FROM users WHERE email = COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai'))
WHERE user_id IS NULL;

UPDATE crm_columns 
SET user_id = (SELECT id FROM users WHERE email = COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai'))
WHERE user_id IS NULL;

UPDATE workflow_runs 
SET user_id = (SELECT id FROM users WHERE email = COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai'))
WHERE user_id IS NULL;

-- Step 5: Make user_id NOT NULL after migration
ALTER TABLE agent_prompts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE leads ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE crm_columns ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE workflow_runs ALTER COLUMN user_id SET NOT NULL;

-- Step 6: Rename global system_config table and create per-user version
ALTER TABLE system_config RENAME TO system_config_global;

CREATE TABLE IF NOT EXISTS system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    key VARCHAR(50) NOT NULL,
    value JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, key)
);

-- Migrate existing system_config data to owner
INSERT INTO system_config (user_id, key, value, updated_at)
SELECT 
    (SELECT id FROM users WHERE email = COALESCE(NULLIF(current_setting('app.owner_email', true), ''), 'owner@elvison.ai')),
    key,
    value,
    updated_at
FROM system_config_global
ON CONFLICT (user_id, key) DO NOTHING;

-- Step 7: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_prompts_user_id ON agent_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_columns_user_id ON crm_columns(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON workflow_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_config_user_id ON system_config(user_id);
CREATE INDEX IF NOT EXISTS idx_system_config_user_key ON system_config(user_id, key);

-- Step 7b: Add unique constraint for agent_prompts (agent_id + user_id)
-- First drop the old unique constraint
ALTER TABLE agent_prompts DROP CONSTRAINT IF EXISTS agent_prompts_agent_id_key;
-- Add new compound unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompts_agent_user ON agent_prompts(agent_id, user_id);

-- Step 8: Add unique constraint to prevent duplicate email addresses (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Migration complete
-- Note: Owner account password must be set via password reset flow on first login
