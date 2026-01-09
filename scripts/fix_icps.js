
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const query = (text, params) => pool.query(text, params);

async function fixICPs() {
    try {
        console.log('🔌 Connecting to DB...');

        // 1. Rename logic
        console.log('\n--- 1. Fixing ICP Names ---');
        // Find "Funds and Family Offices"
        const { rows: fundsICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Funds and Family Offices%'");

        // Find existing "Investment Firms"
        const { rows: invICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Investment Firms%'");

        let investmentFirmId = invICPs[0]?.id;

        if (fundsICPs.length > 0) {
            console.log(`Found ${fundsICPs.length} 'Funds and Family Offices' ICPs.`);

            if (investmentFirmId) {
                // If target already exists, migrate leads and delete old
                console.log(`Target 'Investment Firms' (ID: ${investmentFirmId}) already exists. Migrating leads...`);
                for (const oldIcp of fundsICPs) {
                    const res = await query('UPDATE leads SET icp_id = $1 WHERE icp_id = $2', [investmentFirmId, oldIcp.id]);
                    console.log(`Moved ${res.rowCount} leads from ${oldIcp.name} to Investment Firms.`);
                    await query('DELETE FROM icps WHERE id = $1', [oldIcp.id]);
                    console.log(`Deleted old ICP: ${oldIcp.name}`);
                }
            } else {
                // Just rename the first one and migrate others if duplicates
                const primary = fundsICPs[0];
                await query("UPDATE icps SET name = 'Investment Firms' WHERE id = $1", [primary.id]);
                console.log(`Renamed ICP ${primary.id} to 'Investment Firms'.`);
                investmentFirmId = primary.id;

                for (let i = 1; i < fundsICPs.length; i++) {
                    const extra = fundsICPs[i];
                    const res = await query('UPDATE leads SET icp_id = $1 WHERE icp_id = $2', [investmentFirmId, extra.id]);
                    console.log(`Moved ${res.rowCount} leads from duplicate to main.`);
                    await query('DELETE FROM icps WHERE id = $1', [extra.id]);
                }
            }
        } else {
            console.log("No 'Funds and Family Offices' ICPs found to rename.");
        }

        // 2. Family Offices
        console.log('\n--- 2. Checking Family Offices ---');
        const { rows: foICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Family Office%' AND name NOT ILIKE '%Funds%'");
        if (foICPs.length === 0) {
            console.log("Creating missed 'Family Offices' ICP...");
            // Need a valid user_id
            const { rows: users } = await query('SELECT id FROM users LIMIT 1');
            if (users.length > 0) {
                await query("INSERT INTO icps (name, user_id) VALUES ('Family Offices', $1)", [users[0].id]);
                console.log("Created 'Family Offices' ICP.");
            }
        } else {
            console.log(`Found ${foICPs.length} 'Family Offices' ICPs.`);
        }

        // 3. Orphan check
        console.log('\n--- 3. Checking Orphans ---');
        const { rows: orphans } = await query(`
            SELECT l.id, l.company_name, l.icp_id 
            FROM leads l 
            LEFT JOIN icps i ON l.icp_id = i.id 
            WHERE i.id IS NULL
        `);
        console.log(`Found ${orphans.length} orphaned leads.`);

        if (orphans.length > 0 && investmentFirmId) {
            console.log("Assigning orphans to 'Investment Firms' as fallback...");
            for (const orphan of orphans) {
                await query('UPDATE leads SET icp_id = $1 WHERE id = $2', [investmentFirmId, orphan.id]);
            }
            console.log("Orphans reassigned.");
        }

        // 4. Scoring Audit
        console.log('\n--- 4. Scoring Audit (Sample) ---');
        const { rows: poorScores } = await query(`
            SELECT company_name, custom_data->>'fit_score' as score, icp_id 
            FROM leads 
            WHERE (custom_data->>'fit_score')::numeric BETWEEN 1 AND 5 
            LIMIT 5
        `);
        console.table(poorScores);

    } catch (e) {
        console.error('SCRIPT ERROR:', e);
    } finally {
        await pool.end();
    }
}

fixICPs();
