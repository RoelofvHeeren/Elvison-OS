-- Keep only the top 3 leads per company based on title relevance
-- We prioritize: CEO/MD/Executive > Senior Vice President > Vice President > Asset Management/Investment roles
WITH RankedLeads AS (
    SELECT 
        l.id,
        l.company_name,
        l.job_title,
        ROW_NUMBER() OVER (
            PARTITION BY l.company_name 
            ORDER BY 
                CASE 
                    WHEN l.job_title ILIKE '%CEO%' OR l.job_title ILIKE '%President%' OR l.job_title ILIKE '%Managing Director%' THEN 1
                    WHEN l.job_title ILIKE '%Executive Director%' THEN 2
                    WHEN l.job_title ILIKE '%Senior Vice President%' OR l.job_title ILIKE '%SVP%' THEN 3
                    WHEN l.job_title ILIKE '%Vice President%' OR l.job_title ILIKE '%VP%' THEN 4
                    WHEN l.job_title ILIKE '%Director%' THEN 5
                    WHEN l.job_title ILIKE '%Partner%' THEN 6
                    WHEN l.job_title ILIKE '%Investment%' OR l.job_title ILIKE '%Acquisition%' THEN 7
                    ELSE 8
                END,
                l.person_name
        ) as rank
    FROM leads l
    JOIN leads_link link ON l.id = link.lead_id
    WHERE link.parent_type = 'user'
)
DELETE FROM leads_link 
WHERE lead_id IN (
    SELECT id FROM RankedLeads WHERE rank > 3
);

-- Delete orphaned leads from the leads table
DELETE FROM leads 
WHERE id NOT IN (SELECT lead_id FROM leads_link);

-- Clean up orphaned companies
DELETE FROM companies 
WHERE NOT EXISTS (
    SELECT 1 FROM leads 
    WHERE leads.company_name = companies.company_name
);
