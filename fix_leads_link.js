// Migration script to populate leads_link table for existing leads
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function migrate() {
    try {
        console.log('🔧 Populating leads_link table...\n');

        // 1. Find all leads that are not in leads_link
        const orphanCheck = await pool.query(`
            SELECT l.id, l.icp_id, i.user_id 
            FROM leads l
            LEFT JOIN icps i ON l.icp_id = i.id
            LEFT JOIN leads_link link ON l.id = link.lead_id
            WHERE link.id IS NULL
        `);

        console.log(`Found ${orphanCheck.rows.length} orphaned leads (not in leads_link)`);

        if (orphanCheck.rows.length === 0) {
            console.log('✅ All leads are already linked!');
            return;
        }

        // 2. Get the primary user (assuming single-tenant for now)
        const userResult = await pool.query('SELECT id FROM users LIMIT 1');
        if (userResult.rows.length === 0) {
            console.log('❌ No users found! Cannot link leads.');
            return;
        }
        const userId = userResult.rows[0].id;
        console.log(`Using user ID: ${userId}`);

        // 3. Insert link records for all orphaned leads
        let linked = 0;
        let errors = 0;

        for (const lead of orphanCheck.rows) {
            try {
                // Use the user from the ICP if available, otherwise use the first user
                const parentId = lead.user_id || userId;

                await pool.query(`
                    INSERT INTO leads_link (lead_id, parent_id, parent_type)
                    VALUES ($1, $2, 'user')
                    ON CONFLICT (lead_id) DO NOTHING
                `, [lead.id, parentId]);
                linked++;
            } catch (e) {
                errors++;
                if (errors <= 5) console.log(`  Error linking lead ${lead.id}: ${e.message}`);
            }
        }

        console.log(`\n✅ Linked ${linked} leads to users`);
        if (errors > 0) console.log(`⚠️ ${errors} errors occurred`);

        // 4. Verify
        const verifyResult = await pool.query('SELECT COUNT(*) as total FROM leads_link');
        console.log(`\nleads_link now has ${verifyResult.rows[0].total} entries`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

migrate();
