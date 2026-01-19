-- Add the only missing element from the audit: icps.company_id
-- This allows linking ICPs to specific companies for better tracking.

DO $$ 
BEGIN
    -- Add company_id column to icps table if it doesn't exist
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'icps' 
        AND column_name = 'company_id'
    ) THEN
        ALTER TABLE public.icps ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added icps.company_id column';
    ELSE
        RAISE NOTICE 'icps.company_id already exists';
    END IF;
END $$;
