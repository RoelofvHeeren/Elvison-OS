import { query } from '../db/index.js';

const assignToAll = async () => {
    try {
        const leadId = 'd4ba7485-abf4-4c7e-adbd-5a0469f953f4';

        // 1. Fetch original lead
        const leadRes = await query("SELECT * FROM leads WHERE id = $1", [leadId]);
        const lead = leadRes.rows[0];

        // 2. Fetch all users EXCEPT the one who already has it
        const usersRes = await query("SELECT id, email FROM users WHERE id != $1", [lead.user_id]);

        console.log(`Cloning lead for ${usersRes.rows.length} other users...`);

        for (const user of usersRes.rows) {
            await query(`
                INSERT INTO leads (user_id, company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, outreach_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT DO NOTHING
            `, [
                user.id,
                lead.company_name,
                lead.person_name,
                lead.email,
                lead.job_title,
                lead.linkedin_url,
                lead.status,
                lead.custom_data,
                lead.source,
                lead.outreach_status
            ]);
            console.log(`-> Assigned to ${user.email}`);
        }

        console.log("✅ Done.");
        process.exit(0);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

assignToAll();
