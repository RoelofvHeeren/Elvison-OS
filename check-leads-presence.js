import { query } from './db/index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const checkLeads = async () => {
    try {
        console.log('Using connection string (prefix):', (process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || '').substring(0, 20));
        console.log('Searching for leads...');
        const res = await query(`
            SELECT id, person_name, company_name, user_id, status 
            FROM leads 
            WHERE person_name ILIKE '%Roelof%' OR person_name ILIKE '%Ben Nathan%'
        `);

        if (res.rows.length > 0) {
            console.log('Found leads:');
            console.log(JSON.stringify(res.rows, null, 2));
        } else {
            console.log('No leads found matching those names.');
        }

        // Also search companies table
        const compRes = await query(`
            SELECT id, company_name, website, user_id 
            FROM companies 
            WHERE company_name ILIKE '%Elvison%' OR company_name ILIKE '%Nathan%'
        `);

        if (compRes.rows.length > 0) {
            console.log('\nFound companies:');
            console.log(JSON.stringify(compRes.rows, null, 2));
        } else {
            console.log('\nNo companies found matching those names.');
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

checkLeads();
