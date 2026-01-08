import { query } from './db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function investigate() {
    try {
        console.log("Searching for Family Office ICPs...");
        const icpRes = await query(`SELECT id, name, config FROM icps WHERE name ILIKE '%Family Office%'`);

        if (icpRes.rows.length === 0) {
            console.log("No ICPs found with 'Family Office' in the name.");
        } else {
            console.log(`Found ${icpRes.rows.length} ICPs:`);
            icpRes.rows.forEach(icp => {
                console.log(`- ID: ${icp.id}, Name: ${icp.name}`);
                // console.log(`  Config:`, JSON.stringify(icp.config).substring(0, 100) + "...");
            });

            const icpIds = icpRes.rows.map(row => row.id);

            // Check companies table if it exists and has icp_id, or use leads
            // First check if companies table exists
            try {
                // Determine how companies are linked. 
                // We'll check 'leads' first as we know it has icp_id from server.js
                // But user asked about "companies".
                // Let's check if 'companies' table exists and has icp_id

                // We'll try to select from companies filtering by icp_id if column exists, 
                // otherwise we join with leads or look for another way.

                // Let's try to see if companies have an icp_id
                const companyRes = await query(`
                    SELECT c.id, c.name, c.domain, c.description, c.icp_id 
                    FROM companies c 
                    WHERE c.icp_id = ANY($1) 
                    LIMIT 20
                `, [icpIds]);

                console.log(`\nFound ${companyRes.rows.length} companies associated with these ICPs (sample of 20):`);
                companyRes.rows.forEach(c => {
                    console.log(`- [ID: ${c.id}] ${c.name} (${c.domain})`);
                    console.log(`  Desc: ${c.description ? c.description.substring(0, 100) : 'N/A'}...`);
                });

            } catch (err) {
                console.log("Error querying companies table directly with icp_id:", err.message);
                // Fallback: maybe companies don't have icp_id directly?
                // Or maybe check leads 
            }
        }

    } catch (err) {
        console.error("Investigation failed:", err);
    } finally {
        process.exit();
    }
}

investigate();
