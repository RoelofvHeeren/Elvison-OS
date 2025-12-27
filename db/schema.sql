-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: agent_prompts
-- Stores the configuration and templates for each agent
CREATE TABLE IF NOT EXISTS agent_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'company_finder'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL, -- The actually used prompt
    config JSONB DEFAULT '{}'::jsonb, -- Store raw answers/config here
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: crm_columns
-- Stores the custom data architecture defined by the user
CREATE TABLE IF NOT EXISTS crm_columns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    column_name VARCHAR(100) NOT NULL,
    column_type VARCHAR(50) NOT NULL, -- 'text', 'number', 'select', 'date'
    is_required BOOLEAN DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255), -- For future auth
    name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: leads (Replacing Google Sheet)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255),
    person_name VARCHAR(255),
    email VARCHAR(255),
    job_title VARCHAR(255),
    linkedin_url TEXT,
    status VARCHAR(50) DEFAULT 'NEW', -- NEW, ENRICHED, CONTACTED, etc.
    custom_data JSONB DEFAULT '{}'::jsonb, -- dynamic columns from Data Architect
    source VARCHAR(100), -- e.g. 'Apollo', 'Manual'
    phone_numbers JSONB DEFAULT '[]'::jsonb, -- New column for storing enriched phone numbers
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: icps (Multi-ICP Configurations)
CREATE TABLE IF NOT EXISTS icps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    config JSONB DEFAULT '{}'::jsonb, -- Stores onboarding answers/filters
    agent_config JSONB DEFAULT '{}'::jsonb, -- Stores optimized agent instructions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: workflow_runs (Logging)
-- Modified to link to ICP
CREATE TABLE IF NOT EXISTS workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    icp_id UUID REFERENCES icps(id), -- Nullable for legacy/generic runs
    agent_id VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'RUNNING', 'COMPLETED', 'FAILED'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_log TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    user_id UUID REFERENCES users(id) -- Ensure we track user ownership
);

-- Table: run_feedback (Optimization Data)
CREATE TABLE IF NOT EXISTS run_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID REFERENCES workflow_runs(id),
    icp_id UUID REFERENCES icps(id),
    entity_type VARCHAR(50) NOT NULL, -- 'company', 'contact', 'message'
    entity_identifier VARCHAR(255), -- ID or Name/Email
    grade VARCHAR(20), -- 'positive', 'negative', 'neutral'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: agent_results (Agent Outputs)
CREATE TABLE IF NOT EXISTS agent_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID REFERENCES workflow_runs(id),
    agent_id VARCHAR(50), 
    output_data JSONB NOT NULL, -- The full JSON result from the agent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
