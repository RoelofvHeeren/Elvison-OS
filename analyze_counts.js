// Comprehensive count analysis to understand discrepancies
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com

async function analyze() {
    try {
        console.log('🔍 Count Analysis - Understanding Discrepancies\n');
        console.log('='.repeat(60));

        // 1. CRM Page Query - counts unique companies from leads
        const crmCompanies = await pool.query(`
            SELECT COUNT(DISTINCT l.company_name) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_id = $1 AND link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.linkedin_message NOT LIKE '[SKIPPED%' OR l.linkedin_message IS NULL)
        `, [userId]);

        const crmLeads = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_id = $1 AND link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
        `, [userId]);

        console.log(`\n📊 CRM PAGE LOGIC:`);
        console.log(`   Unique companies with non-skipped leads: ${crmCompanies.rows[0].count}`);
        console.log(`   Total non-disqualified leads: ${crmLeads.rows[0].count}`);

        // 2. Companies Page - counts from companies table
        const companiesAll = await pool.query(`
            SELECT COUNT(*) as count FROM companies 
            WHERE user_id = $1 
            AND (fit_score > 5 OR fit_score IS NULL OR cleanup_status = 'KEPT')
        `, [userId]);

        const companiesLeads = await pool.query(`
            SELECT SUM(
                (SELECT COUNT(*) FROM leads l
                 JOIN leads_link link ON l.id = link.lead_id
                 WHERE l.company_name = c.company_name 
                 AND link.parent_id = c.user_id AND link.parent_type = 'user'
                 AND l.status != 'DISQUALIFIED'
                 AND (l.linkedin_message NOT LIKE '[SKIPPED%' OR l.linkedin_message IS NULL))
            ) as total
            FROM companies c
            WHERE c.user_id = $1
            AND (c.fit_score > 5 OR c.fit_score IS NULL OR c.cleanup_status = 'KEPT')
        `, [userId]);

        console.log(`\n📊 COMPANIES PAGE LOGIC:`);
        console.log(`   Companies (fit_score > 5 OR NULL OR KEPT): ${companiesAll.rows[0].count}`);
        console.log(`   Sum of lead counts for these companies: ${companiesLeads.rows[0].total || 0}`);

        // 3. Family Office ICP
        const familyOfficeIcp = await pool.query(`SELECT id FROM icps WHERE name LIKE '%Family%' LIMIT 1`);
        const foId = familyOfficeIcp.rows[0]?.id;

        if (foId) {
            const foCompanies = await pool.query(`
                SELECT COUNT(DISTINCT c.id) as count FROM companies c
                WHERE c.user_id = $1
                AND (c.fit_score > 5 OR c.fit_score IS NULL OR c.cleanup_status = 'KEPT')
                AND EXISTS (
                    SELECT 1 FROM leads l
                    JOIN leads_link link ON l.id = link.lead_id
                    WHERE l.company_name = c.company_name 
                    AND link.parent_id = c.user_id AND link.parent_type = 'user'
                    AND l.icp_id = $2 AND l.status != 'DISQUALIFIED'
                )
            `, [userId, foId]);

            const foLeads = await pool.query(`
                SELECT COUNT(*) as count FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE link.parent_id = $1 AND link.parent_type = 'user'
                AND l.icp_id = $2 AND l.status != 'DISQUALIFIED'
            `, [userId, foId]);

            console.log(`\n📊 FAMILY OFFICE ICP (${foId}):`);
            console.log(`   Companies with Family Office leads: ${foCompanies.rows[0].count}`);
            console.log(`   Family Office leads: ${foLeads.rows[0].count}`);
        }

        // 4. Investment Fund ICP
        const investmentIcp = await pool.query(`SELECT id FROM icps WHERE name LIKE '%Investment%' OR name LIKE '%Fund%' LIMIT 1`);
        const ifId = investmentIcp.rows[0]?.id;

        if (ifId) {
            const ifCompanies = await pool.query(`
                SELECT COUNT(DISTINCT c.id) as count FROM companies c
                WHERE c.user_id = $1
                AND (c.fit_score > 5 OR c.fit_score IS NULL OR c.cleanup_status = 'KEPT')
                AND EXISTS (
                    SELECT 1 FROM leads l
                    JOIN leads_link link ON l.id = link.lead_id
                    WHERE l.company_name = c.company_name 
                    AND link.parent_id = c.user_id AND link.parent_type = 'user'
                    AND l.icp_id = $2 AND l.status != 'DISQUALIFIED'
                )
            `, [userId, ifId]);

            const ifLeads = await pool.query(`
                SELECT COUNT(*) as count FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE link.parent_id = $1 AND link.parent_type = 'user'
                AND l.icp_id = $2 AND l.status != 'DISQUALIFIED'
            `, [userId, ifId]);

            console.log(`\n📊 INVESTMENT FUND ICP (${ifId}):`);
            console.log(`   Companies with Investment Fund leads: ${ifCompanies.rows[0].count}`);
            console.log(`   Investment Fund leads: ${ifLeads.rows[0].count}`);
        }

        // 5. Discrepancy analysis
        console.log('\n' + '='.repeat(60));
        console.log('📊 DISCREPANCY ANALYSIS:');

        // Why 195 companies but only 76 have leads?
        const companiesWithLeads = await pool.query(`
            SELECT COUNT(*) as count FROM companies c
            WHERE c.user_id = $1
            AND EXISTS (
                SELECT 1 FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id AND link.parent_type = 'user'
                AND l.status != 'DISQUALIFIED'
            )
        `, [userId]);

        const companiesWithoutLeads = await pool.query(`
            SELECT COUNT(*) as count FROM companies c
            WHERE c.user_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id AND link.parent_type = 'user'
                AND l.status != 'DISQUALIFIED'
            )
        `, [userId]);

        console.log(`   Companies WITH leads in leads_link: ${companiesWithLeads.rows[0].count}`);
        console.log(`   Companies WITHOUT leads in leads_link: ${companiesWithoutLeads.rows[0].count}`);

        // 6. Check for name mismatches
        const leadCompanyNames = await pool.query(`
            SELECT DISTINCT l.company_name FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_id = $1 AND link.parent_type = 'user'
            LIMIT 5
        `, [userId]);

        const companyNames = await pool.query(`
            SELECT company_name FROM companies WHERE user_id = $1 LIMIT 5
        `, [userId]);

        console.log(`\n   Sample lead company names: ${leadCompanyNames.rows.map(r => r.company_name).join(', ')}`);
        console.log(`   Sample company names: ${companyNames.rows.map(r => r.company_name).join(', ')}`);

        // 7. Total leads by status
        const leadsByStatus = await pool.query(`
            SELECT l.status, COUNT(*) as count FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_id = $1 AND link.parent_type = 'user'
            GROUP BY l.status ORDER BY count DESC
        `, [userId]);
        console.log(`\n   Leads by status:`);
        leadsByStatus.rows.forEach(r => console.log(`     - ${r.status}: ${r.count}`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

analyze();
