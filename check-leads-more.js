import { query } from './db/index.js';

const checkLeadsMore = async () => {
    try {
        console.log('Searching for leads using Rulof and users...');
        const res = await query(`
            SELECT id, person_name, company_name, user_id, status 
            FROM leads 
            WHERE person_name ILIKE '%Rulof%' OR person_name ILIKE '%Roelof%'
        `);

        console.log('Found leads:');
        console.log(JSON.stringify(res.rows, null, 2));

        const userRes = await query(`
            SELECT id, email FROM users
        `);
        console.log('\nUsers:');
        console.log(JSON.stringify(userRes.rows, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

checkLeadsMore();
