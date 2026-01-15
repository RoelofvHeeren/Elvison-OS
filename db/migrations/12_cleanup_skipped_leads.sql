-- Cleanup Skipped Leads (Garbage Collection)

-- 1. Remove Link Table References
DELETE FROM leads_link_table 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE linkedin_message LIKE '[SKIPPED%' OR email_body LIKE '[SKIPPED%'
);

-- 2. Remove Feedback Links
DELETE FROM lead_feedback_link_table 
WHERE lead_feedback_id IN (
    SELECT id FROM lead_feedback 
    WHERE lead_id IN (
        SELECT id FROM leads 
        WHERE linkedin_message LIKE '[SKIPPED%' OR email_body LIKE '[SKIPPED%'
    )
);

-- 3. Remove Feedback
DELETE FROM lead_feedback 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE linkedin_message LIKE '[SKIPPED%' OR email_body LIKE '[SKIPPED%'
);

-- 4. Remove The Leads
DELETE FROM leads 
WHERE linkedin_message LIKE '[SKIPPED%' OR email_body LIKE '[SKIPPED%';
