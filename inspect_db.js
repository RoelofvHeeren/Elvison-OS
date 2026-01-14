
import { query, pool } from './db/index.js';

async function runInspection() {
    try {
        console.log('--- STARTING DB INSPECTION ---');

        // 1. Get All Users
        const userRes = await query('SELECT id, email FROM users');
        console.log(`Found ${userRes.rows.length} users. Starting inspection...`);

        for (const user of userRes.rows) {
            const userId = user.id;
            console.log(`\n=== Inspecting User: ${user.email} (${userId}) ===`);

            // 2. Count Companies by ICP Type (to explain the 13 missing from 133 total)
            const typeBreakdown = await query(`
            SELECT icp_type, COUNT(*) as count 
            FROM companies 
            WHERE user_id = $1 
            AND (fit_score > 5 OR fit_score IS NULL OR cleanup_status = 'KEPT') -- Match the frontend filter
            GROUP BY icp_type
        `, [userId]);

            console.log('\n--- Company Categorization Breakdown ---');
            console.table(typeBreakdown.rows);

            // 3. Check for Companies with NO Leads (to explain 133 vs 129 mismatch)
            const companiesWithoutLeads = await query(`
            SELECT c.company_name, c.icp_type, c.fit_score
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name AND c.user_id = l.user_id
            WHERE c.user_id = $1 
            AND l.id IS NULL
            AND (c.fit_score > 5 OR c.fit_score IS NULL OR c.cleanup_status = 'KEPT')
        `, [userId]);

            console.log(`\n--- Companies with ZERO Leads (Visible in Companies, Hidden in CRM) ---`);
            console.log(`Count: ${companiesWithoutLeads.rows.length}`);
            if (companiesWithoutLeads.rows.length > 0) {
                console.table(companiesWithoutLeads.rows.map(c => ({
                    name: c.company_name,
                    type: c.icp_type,
                    score: c.fit_score
                })));
            }

            // 4. Double Check Total Visible Counts
            const totalCompaniesVisible = await query(`
            SELECT COUNT(*) FROM companies 
            WHERE user_id = $1 
            AND (fit_score > 5 OR fit_score IS NULL OR cleanup_status = 'KEPT')
        `, [userId]);
            console.log(`\nTotal Visible Companies (DB): ${totalCompaniesVisible.rows[0].count}`);

            const totalUniqueCompInCRM = await query(`
             SELECT COUNT(DISTINCT l.company_name)
             FROM leads l
             LEFT JOIN companies c ON l.company_name = c.company_name AND l.user_id = c.user_id
             WHERE l.user_id = $1
             AND (c.fit_score > 5 OR c.fit_score IS NULL OR l.status IN ('ENRICHED', 'CONTACTED', 'APPROVED'))
        `, [userId]);
            console.log(`Total Unique Companies in CRM (DB): ${totalUniqueCompInCRM.rows[0].count}`);


        }
    } catch (e) {
        console.error('Inspection Failed:', e);
    } finally {
        // process.exit(); // Let pool close naturally if possible, or force it
        setTimeout(() => process.exit(0), 1000);
    }
}

runInspection();
