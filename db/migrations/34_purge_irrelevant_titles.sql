-- Delete leads with irrelevant job titles
-- These people are likely not involved in real estate investment/development decisions

DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM leads 
    WHERE (
        job_title ILIKE '%IT %' 
        OR job_title ILIKE '%Technology%'
        OR job_title ILIKE '%Audit%'
        OR job_title ILIKE '%Accounting%'
        OR job_title ILIKE '%HR%'
        OR job_title ILIKE '%Human Resources%'
        OR job_title ILIKE '%Marketing%'
        OR job_title ILIKE '%PR%'
        OR job_title ILIKE '%Public Relations%'
        OR job_title ILIKE '%Policy%'
        OR job_title ILIKE '%Legal%' -- Unless it's RE legal, usually not the best start
        OR job_title ILIKE '%Compliance%'
        OR job_title ILIKE '%Secretary%'
        OR job_title ILIKE '%Assistant%'
        OR job_title ILIKE '%Admin%'
        OR job_title ILIKE '%Recruiter%'
        OR job_title ILIKE '%Student%'
        OR job_title ILIKE '%Intern%'
        OR job_title ILIKE '%Customer Service%'
        OR job_title ILIKE '%Operation%' -- Often internal ops, not investment ops
    )
    AND job_title NOT ILIKE '%Real Estate%'
    AND job_title NOT ILIKE '%Investment%'
    AND job_title NOT ILIKE '%Acquisition%'
);

DELETE FROM leads 
WHERE (
    job_title ILIKE '%IT %' 
    OR job_title ILIKE '%Technology%'
    OR job_title ILIKE '%Audit%'
    OR job_title ILIKE '%Accounting%'
    OR job_title ILIKE '%HR%'
    OR job_title ILIKE '%Human Resources%'
    OR job_title ILIKE '%Marketing%'
    OR job_title ILIKE '%PR%'
    OR job_title ILIKE '%Public Relations%'
    OR job_title ILIKE '%Policy%'
    OR job_title ILIKE '%Legal%'
    OR job_title ILIKE '%Compliance%'
    OR job_title ILIKE '%Secretary%'
    OR job_title ILIKE '%Assistant%'
    OR job_title ILIKE '%Admin%'
    OR job_title ILIKE '%Recruiter%'
    OR job_title ILIKE '%Student%'
    OR job_title ILIKE '%Intern%'
    OR job_title ILIKE '%Customer Service%'
    OR job_title ILIKE '%Operation%'
)
AND job_title NOT ILIKE '%Real Estate%'
AND job_title NOT ILIKE '%Investment%'
AND job_title NOT ILIKE '%Acquisition%';
