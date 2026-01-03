import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        // Get all leads with their company info
        const result = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                id, company_name, person_name, job_title, 
                custom_data->>'company_profile' as profile,
                custom_data->>'company_website' as website,
                status, created_at
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            ORDER BY company_name, created_at DESC
            LIMIT 50
        `);

        console.log(`Found ${result.rows.length} unique companies:\n`);
        result.rows.forEach((row, i) => {
            console.log(`${i + 1}. ${row.company_name}`);
            console.log(`   Website: ${row.website || 'N/A'}`);
            console.log(`   Profile: ${row.profile ? row.profile.substring(0, 100) + '...' : 'No profile'}`);
            console.log(`   Status: ${row.status}`);
            console.log('');
        });

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

main();
