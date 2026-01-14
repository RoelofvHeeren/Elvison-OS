import { query } from './db/index.js';

const listMyLeads = async () => {
    try {
        const userId = '40ac42ec-48bc-4069-864b-c47a02ed9b40'; // roelof@elvison.com
        console.log(`Listing leads for user: ${userId}`);
        const res = await query(`
            SELECT id, person_name, company_name, status 
            FROM leads 
            WHERE user_id = $1
        `, [userId]);

        console.log('Your leads:');
        console.log(JSON.stringify(res.rows, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

listMyLeads();
