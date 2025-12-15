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

-- Table: users (Placeholder for multi-tenancy)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
