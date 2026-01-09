
import { query } from './db/index.js';

async function reclaimNulls() {
    try {
        console.log('🧹 Reclaiming NULL Leads...');

        // 1. Get Target ICP ID (Investment Fund Strategy)
        const { rows: targets } = await query("SELECT id, name FROM icps WHERE name = 'Investment Fund Strategy'");
        if (targets.length === 0) {
            console.error('❌ Could not find "Investment Fund Strategy" ICP. Aborting.');
            process.exit(1);
        }
        const targetId = targets[0].id;
        console.log(`✅ Target ICP: ${targets[0].name} (${targetId})`);

        // 2. Count NULLs
        const { rows: nulls } = await query('SELECT COUNT(*) as count FROM leads WHERE icp_id IS NULL');
        console.log(`found ${nulls[0].count} leads with NULL ICP.`);

        // 3. Update
        if (parseInt(nulls[0].count) > 0) {
            console.log('🚀 Updating leads...');
            const res = await query('UPDATE leads SET icp_id = $1 WHERE icp_id IS NULL', [targetId]);
            console.log(`✅ Updated ${res.rowCount} leads to belong to "${targets[0].name}".`);
        } else {
            console.log('Thinking... No NULL leads found.');
            // Double check if there were leads with invalid UUIDs instead of NULL?
        }

    } catch (e) {
        console.error('ERROR:', e);
    }
    process.exit();
}

reclaimNulls();
