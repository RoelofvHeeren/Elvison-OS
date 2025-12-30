-- Clean up Blackstone leads that failed outreach or have no status
-- Note: outreach_status is stored inside the custom_data JSONB column
DELETE FROM leads 
WHERE company_name ILIKE '%blackstone%' 
AND (
    custom_data->>'outreach_status' IS NULL 
    OR custom_data->>'outreach_status' = 'failed_generation' 
    OR custom_data->>'outreach_status' = 'pending'
);

-- Clean up leads with irrelevant titles created in the last 24 hours
-- Note: DB column is 'job_title'
DELETE FROM leads 
WHERE created_at > NOW() - INTERVAL '24 hours'
AND (
    job_title ILIKE '%intern%' OR 
    job_title ILIKE '%student%' OR 
    job_title ILIKE '%assistant%' OR 
    job_title ILIKE '%coordinator%' OR 
    job_title ILIKE '%hr%' OR 
    job_title ILIKE '%human resources%' OR 
    job_title ILIKE '%talent%' OR 
    job_title ILIKE '%recruiting%' OR 
    job_title ILIKE '%events%' OR 
    job_title ILIKE '%operations%' OR 
    job_title ILIKE '%cybersecurity%' OR 
    job_title ILIKE '%technician%' OR 
    job_title ILIKE '%support%' OR 
    job_title ILIKE '%administrative%' OR 
    job_title ILIKE '%admin%' OR 
    job_title ILIKE '%clerk%'
);
