-- Clean up Blackstone leads that failed outreach or have no status
DELETE FROM leads 
WHERE company_name ILIKE '%blackstone%' 
AND (outreach_status IS NULL OR outreach_status = 'failed_generation' OR outreach_status = 'pending');

-- Clean up leads with irrelevant titles created in the last 24 hours
DELETE FROM leads 
WHERE created_at > NOW() - INTERVAL '24 hours'
AND (
    title ILIKE '%intern%' OR 
    title ILIKE '%student%' OR 
    title ILIKE '%assistant%' OR 
    title ILIKE '%coordinator%' OR 
    title ILIKE '%hr%' OR 
    title ILIKE '%human resources%' OR 
    title ILIKE '%talent%' OR 
    title ILIKE '%recruiting%' OR 
    title ILIKE '%events%' OR 
    title ILIKE '%operations%' OR 
    title ILIKE '%cybersecurity%' OR 
    title ILIKE '%technician%' OR 
    title ILIKE '%support%' OR 
    title ILIKE '%administrative%' OR 
    title ILIKE '%admin%' OR 
    title ILIKE '%clerk%'
);

-- Optional: Reset 'failed_generation' leads to 'pending' if you want to retry them
-- UPDATE leads SET outreach_status = 'pending' WHERE outreach_status = 'failed_generation';
