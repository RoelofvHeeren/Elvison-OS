
import { query } from './db/index.js';

async function debugOrphans() {
    try {
        console.log('🔍 Analyzing Leads and ICPs...');

        // 1. List all current ICPs
        console.log('\n--- Current ICPs ---');
        const { rows: icps } = await query('SELECT id, name FROM icps');
        console.table(icps);

        // 2. Group leads by ICP ID
        console.log('\n--- Leads by ICP ID ---');
        const { rows: leadStats } = await query(`
            SELECT 
                l.icp_id,
                i.name as icp_name,
                COUNT(*) as lead_count,
                COUNT(DISTINCT l.company_name) as company_count
            FROM leads l
            LEFT JOIN icps i ON l.icp_id = i.id
            GROUP BY l.icp_id, i.name
            ORDER BY lead_count DESC
        `);
        console.table(leadStats);

        // 3. Show a few sample "orphans" (leads with no matching ICP name)
        const orphans = leadStats.filter(s => !s.icp_name);
        if (orphans.length > 0) {
            console.log('\n⚠️ Found orphaned groups:', orphans);

            const orphanId = orphans[0].icp_id;
            console.log(`\n--- Sample Companies in Orphan Group (${orphanId}) ---`);
            const { rows: methods } = await query('SELECT company_name, id FROM leads WHERE icp_id = $1 LIMIT 5', [orphanId]);
            console.table(methods);
        } else {
            console.log('\n✅ No strictly orphaned leads found (all map to an existing ICP).');
            // If no orphans, maybe they are mapped to an ICP we just don't see in the UI filter?
        }

    } catch (e) {
        console.error('ERROR:', e);
    }
    process.exit();
}

debugOrphans();
