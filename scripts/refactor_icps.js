
import { query } from '../db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function refactorICPs() {
    console.log('🔄 Refactoring ICPs...');

    try {
        // 1. Rename "Funds and Family Offices" to "Investment Firms"
        const fundsRes = await query(`
            SELECT id, name FROM icps 
            WHERE name ILIKE '%Funds%' AND name ILIKE '%Family Offices%'
        `);

        if (fundsRes.rows.length > 0) {
            for (const icp of fundsRes.rows) {
                console.log(`Found target ICP: ${icp.name} (ID: ${icp.id})`);
                await query(`
                    UPDATE icps 
                    SET name = 'Investment Firms', updated_at = NOW() 
                    WHERE id = $1
                `, [icp.id]);
                console.log(`✅ Renamed to 'Investment Firms'`);
            }
        } else {
            console.log('ℹ️ No ICP found matching "Funds and Family Offices" specifically.');
        }

        // 2. Ensure "Family Offices" exists
        const familyRes = await query(`
            SELECT id, name FROM icps 
            WHERE name = 'Family Offices' OR name = 'Family Office'
        `);

        if (familyRes.rows.length === 0) {
            console.log('Creating "Family Offices" ICP...');
            const userRes = await query('SELECT id FROM users LIMIT 1');
            if (userRes.rows.length > 0) {
                const userId = userRes.rows[0].id;
                await query(`
                    INSERT INTO icps (user_id, name, config, agent_config)
                    VALUES ($1, 'Family Offices', '{}', '{}')
                `, [userId]);
                console.log('✅ Created "Family Offices" ICP');
            } else {
                console.warn('⚠️ Could not create Family Offices ICP: No users found.');
            }
        } else {
            console.log(`✅ "Family Offices" ICP already exists (ID: ${familyRes.rows[0].id})`);
        }

    } catch (e) {
        console.error('❌ Error:', e);
    }
    // Note: Pool ends gracefully in app, but for script we heavily rely on event loop exit or manual process exit
    // Since we import pool from db/index, we can't easily close it unless we export it. 
    // We'll just let the script exit.
    process.exit(0);
}

refactorICPs();
