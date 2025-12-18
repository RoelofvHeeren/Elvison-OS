-- Add credits column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 500000;

-- Ensure at least one user exists (the admin) if not present, to hold the credits
INSERT INTO users (email, name, role, credits)
VALUES ('admin@elvison.ai', 'Admin', 'admin', 500000)
ON CONFLICT (email) DO UPDATE SET credits = 500000;
