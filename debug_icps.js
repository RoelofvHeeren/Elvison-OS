
import { query } from './db/index.js';

async function debugICPs() {
    try {
        console.log('--- ICPs ---');
        const icps = await query('SELECT * FROM icps');
        console.table(icps.rows);

        console.log('\n--- Leads Count by ICP ---');
        const stats = await query(`
            SELECT 
                icp_id, 
                COUNT(*) as total_leads, 
                COUNT(DISTINCT company_name) as total_companies 
            FROM leads 
            GROUP BY icp_id
        `);
        console.table(stats.rows);

        console.log('\n--- Sample Leads with Old ICP? ---');
        // Check if leads are pointing to an ICP ID that doesn't exist?
        const orphans = await query(`
            SELECT l.id, l.company_name, l.icp_id 
            FROM leads l 
            LEFT JOIN icps i ON l.icp_id = i.id 
            WHERE i.id IS NULL
        `);
        console.log(`Orphaned Leads (Invalid ICP ID): ${orphans.rows.length}`);

    } catch (e) {
        console.error(e);
    }
    process.exit();
}

debugICPs();
