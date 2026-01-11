import { query } from '../db/index.js';

const verify = async () => {
    try {
        const res = await query("SELECT id, user_id, person_name, email, status, source FROM leads WHERE person_name ILIKE '%Ben Nathan%'");
        console.log("Found Leads:", res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

verify();
