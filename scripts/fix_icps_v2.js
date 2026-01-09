
import { query } from './db/index.js';

async function fixICPs() {
    try {
        console.log('🔌 Connecting to DB via shared module...');

        // 1. Rename "Funds & Family Offices" (or similar) to "Investment Fund Strategy"
        console.log('\n--- 1. Fixing "Funds & Family Offices" ---');
        // Search for the problematic combined ICP
        // Note: Using broad matching for '&' or 'and'
        const { rows: combinedICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Funds%Family%'");

        if (combinedICPs.length === 0) {
            console.log("No 'Funds & Family Offices' style ICP found. Checking for 'Investment Fund Strategy'...");
        }

        // Search for target "Investment Fund Strategy"
        const { rows: invICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Investment Fund Strategy%' OR name ILIKE 'Investment Firms'");

        let targetId = invICPs[0]?.id;

        for (const oldIcp of combinedICPs) {
            console.log(`Found combined ICP: "${oldIcp.name}" (ID: ${oldIcp.id})`);

            if (targetId && targetId !== oldIcp.id) {
                // Target already exists separate from this one? Merge.
                console.log(`Merging leads from "${oldIcp.name}" to target (ID: ${targetId})...`);
                await query('UPDATE leads SET icp_id = $1 WHERE icp_id = $2', [targetId, oldIcp.id]);
                await query('DELETE FROM icps WHERE id = $1', [oldIcp.id]);
                console.log(`Deleted "${oldIcp.name}"`);
            } else {
                // Rename in place
                const newName = "Investment Fund Strategy";
                console.log(`Renaming "${oldIcp.name}" to "${newName}"...`);
                await query("UPDATE icps SET name = $1 WHERE id = $2", [newName, oldIcp.id]);
                targetId = oldIcp.id; // This is now our target
            }
        }

        // 2. Ensure "Family Office Strategy" exists
        console.log('\n--- 2. Checking "Family Office Strategy" ---');
        const { rows: foICPs } = await query("SELECT * FROM icps WHERE name ILIKE '%Family Office Strategy%'");

        // Also check for just "Family Offices" if we need to rename it to "Family Office Strategy"
        const { rows: simpleFO } = await query("SELECT * FROM icps WHERE name = 'Family Offices'");

        if (foICPs.length > 0) {
            console.log(`"Family Office Strategy" exists (ID: ${foICPs[0].id}).`);
            // If we have "Family Offices" (simple) separately, merge it into "Strategy"?
            if (simpleFO.length > 0) {
                const destId = foICPs[0].id;
                for (const s of simpleFO) {
                    if (s.id !== destId) {
                        console.log(`Merging "Family Offices" (ID: ${s.id}) into "Family Office Strategy"...`);
                        await query('UPDATE leads SET icp_id = $1 WHERE icp_id = $2', [destId, s.id]);
                        await query('DELETE FROM icps WHERE id = $1', [s.id]);
                    }
                }
            }
        } else {
            if (simpleFO.length > 0) {
                console.log(`Renaming "Family Offices" to "Family Office Strategy"...`);
                await query("UPDATE icps SET name = 'Family Office Strategy' WHERE id = $1", [simpleFO[0].id]);
            } else {
                console.log("Creating new 'Family Office Strategy'...");
                // Need a user_id
                const { rows: users } = await query('SELECT id FROM users LIMIT 1');
                if (users.length > 0) {
                    await query("INSERT INTO icps (name, user_id) VALUES ('Family Office Strategy', $1)", [users[0].id]);
                }
            }
        }

        console.log('\n--- Done ---');

    } catch (e) {
        console.error('SCRIPT ERROR:', e);
    }
    // Force exit because pool might keep open
    process.exit();
}

fixICPs();
