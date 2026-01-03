import { query } from '../../db/index.js';

/**
 * Company Tracker Module
 * Manages tracking of researched and contacted companies to prevent reuse
 */

/**
 * Get list of excluded company domains for a user
 * @param {string} userId - User ID
 * @returns {Promise<string[]>} - Array of domains to exclude
 */
export async function getExcludedDomains(userId) {
    try {
        const researched = await query(
            `SELECT DISTINCT domain 
             FROM researched_companies 
             WHERE user_id = $1 
             AND status IN ('researched', 'contacted')
             AND domain IS NOT NULL`,
            [userId]
        );

        // Also check leads table (CRM) for existing companies
        const leads = await query(
            `SELECT DISTINCT (custom_data->>'company_domain') as domain
             FROM leads
             WHERE user_id = $1 
             AND (custom_data->>'company_domain') IS NOT NULL`,
            [userId]
        );

        const allDomains = [...new Set([
            ...researched.rows.map(row => row.domain),
            ...leads.rows.map(row => row.domain)
        ])];

        return allDomains;
    } catch (err) {
        console.error('Failed to fetch excluded domains:', err);
        return [];
    }
}

/**
 * Get list of excluded company names for a user
 * @param {string} userId - User ID
 * @returns {Promise<string[]>} - Array of company names to exclude
 */
export async function getExcludedCompanyNames(userId) {
    try {
        const researched = await query(
            `SELECT DISTINCT company_name 
             FROM researched_companies 
             WHERE user_id = $1 
             AND status IN ('researched', 'contacted')`,
            [userId]
        );

        // Also check leads table (CRM)
        const leads = await query(
            `SELECT DISTINCT company_name
             FROM leads
             WHERE user_id = $1`,
            [userId]
        );

        const allNames = [...new Set([
            ...researched.rows.map(row => row.company_name),
            ...leads.rows.map(row => row.company_name)
        ])];

        return allNames;
    } catch (err) {
        console.error('Failed to fetch excluded company names:', err);
        return [];
    }
}

/**
 * Check if specific domains are already researched
 * @param {string} userId - User ID
 * @param {string[]} domains - Array of domains to check
 * @returns {Promise<Set<string>>} - Set of domains that are already researched
 */
export async function getResearchedDomainsFromList(userId, domains) {
    if (!domains || domains.length === 0) {
        return new Set();
    }

    try {
        const result = await query(
            `SELECT DISTINCT domain 
             FROM researched_companies 
             WHERE user_id = $1 
             AND domain = ANY($2::text[])`,
            [userId, domains]
        );

        return new Set(result.rows.map(row => row.domain));
    } catch (err) {
        console.error('Failed to check researched domains:', err);
        return new Set();
    }
}

/**
 * Mark companies as researched in the database
 * @param {string} userId - User ID
 * @param {Object[]} companies - Array of company objects
 * @param {string} companies[].name - Company name
 * @param {string} companies[].domain - Company domain
 * @param {number} companies[].leadCount - Number of leads extracted
 * @param {Object} companies[].metadata - Additional metadata
 * @returns {Promise<void>}
 */
export async function markCompaniesAsResearched(userId, companies) {
    if (!companies || companies.length === 0) {
        return;
    }

    try {
        await query('BEGIN');

        for (const company of companies) {
            const { name, domain, leadCount = 0, metadata = {} } = company;

            // Skip if domain is missing
            if (!domain) {
                console.warn(`Skipping company without domain: ${name}`);
                continue;
            }

            await query(
                `INSERT INTO researched_companies 
                 (user_id, company_name, domain, status, lead_count, metadata, researched_at)
                 VALUES ($1, $2, $3, 'researched', $4, $5, NOW())
                 ON CONFLICT (user_id, domain) 
                 DO UPDATE SET
                    lead_count = researched_companies.lead_count + EXCLUDED.lead_count,
                    metadata = researched_companies.metadata || EXCLUDED.metadata,
                    updated_at = NOW()`,
                [userId, name, domain, leadCount, JSON.stringify(metadata)]
            );
        }

        await query('COMMIT');
    } catch (err) {
        await query('ROLLBACK');
        console.error('Failed to mark companies as researched:', err);
        throw err;
    }
}

/**
 * Update company status (e.g., from 'researched' to 'contacted')
 * @param {string} userId - User ID
 * @param {string} domain - Company domain
 * @param {string} newStatus - New status ('contacted', etc.)
 * @returns {Promise<void>}
 */
export async function updateCompanyStatus(userId, domain, newStatus) {
    try {
        await query(
            `UPDATE researched_companies
             SET status = $3,
                 updated_at = NOW(),
                 contacted_at = CASE WHEN $3 = 'contacted' THEN NOW() ELSE contacted_at END
             WHERE user_id = $1 AND domain = $2`,
            [userId, domain, newStatus]
        );
    } catch (err) {
        console.error('Failed to update company status:', err);
        throw err;
    }
}

/**
 * Get statistics about researched companies for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Statistics object
 */
export async function getCompanyStats(userId) {
    try {
        const result = await query(
            `SELECT 
                COUNT(*) as total_companies,
                COUNT(CASE WHEN status = 'researched' THEN 1 END) as researched_count,
                COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_count,
                SUM(lead_count) as total_leads_extracted
             FROM researched_companies
             WHERE user_id = $1`,
            [userId]
        );

        return result.rows[0] || {
            total_companies: 0,
            researched_count: 0,
            contacted_count: 0,
            total_leads_extracted: 0
        };
    } catch (err) {
        console.error('Failed to get company stats:', err);
        return {
            total_companies: 0,
            researched_count: 0,
            contacted_count: 0,
            total_leads_extracted: 0
        };
    }
}

/**
 * Delete tracking for specific companies (for testing/cleanup)
 * @param {string} userId - User ID
 * @param {string[]} domains - Domains to delete
 * @returns {Promise<void>}
 */
export async function deleteCompanyTracking(userId, domains) {
    try {
        await query(
            `DELETE FROM researched_companies
             WHERE user_id = $1 AND domain = ANY($2::text[])`,
            [userId, domains]
        );
    } catch (err) {
        console.error('Failed to delete company tracking:', err);
        throw err;
    }
}
