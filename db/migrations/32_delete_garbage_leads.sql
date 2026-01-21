-- Step 1: Delete leads with [SKIPPED] messages (garbage data)
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE connection_request LIKE '%[SKIPPED%'
       OR email_message LIKE '%[SKIPPED%'
       OR linkedin_message LIKE '%[SKIPPED%'
);

DELETE FROM leads 
WHERE connection_request LIKE '%[SKIPPED%'
   OR email_message LIKE '%[SKIPPED%'
   OR linkedin_message LIKE '%[SKIPPED%';

-- Step 2: Delete leads without job titles (can't do outreach without knowing their role)
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE job_title IS NULL OR job_title = '' OR job_title = '—'
);

DELETE FROM leads 
WHERE job_title IS NULL OR job_title = '' OR job_title = '—';

-- Step 3: Delete junk companies (stealth, consulting firms, etc.)
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT l.id FROM leads l
    WHERE l.company_name ILIKE '%stealth%'
       OR l.company_name ILIKE '%consulting%'
       OR l.company_name ILIKE '%unknown%'
);

DELETE FROM leads 
WHERE company_name ILIKE '%stealth%'
   OR company_name ILIKE '%consulting%'
   OR company_name ILIKE '%unknown%';

-- Step 4: Delete orphaned companies
DELETE FROM companies 
WHERE NOT EXISTS (
    SELECT 1 FROM leads 
    WHERE leads.company_name = companies.company_name
);
