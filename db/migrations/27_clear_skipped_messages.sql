-- Clear bad [SKIPPED] messages from leads and companies
UPDATE leads 
SET linkedin_message = NULL, email_subject = NULL, email_body = NULL
WHERE linkedin_message LIKE '%[SKIPPED]%' OR email_subject LIKE '%[SKIPPED]%';

UPDATE companies
SET linkedin_message = NULL, email_subject = NULL, email_body = NULL
WHERE linkedin_message LIKE '%[SKIPPED]%' OR email_subject LIKE '%[SKIPPED]%';
