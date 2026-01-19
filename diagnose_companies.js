// Check why leads count is 0 on companies page
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function check() {
    try {
        console.log('🔍 Checking why Companies page shows 0 leads\n');

        // 1. Check how many leads have user_id set
        const leadsWithUserId = await pool.query(`SELECT COUNT(*) as total, user_id FROM leads GROUP BY user_id`);
        console.log('Leads by user_id:');
        leadsWithUserId.rows.forEach(r => console.log(`  - user_id: ${r.user_id || 'NULL'} -> ${r.total} leads`));

        // 2. Check companies user_id
        const companiesByUser = await pool.query(`SELECT COUNT(*) as total, user_id FROM companies GROUP BY user_id`);
        console.log('\nCompanies by user_id:');
        companiesByUser.rows.forEach(r => console.log(`  - user_id: ${r.user_id || 'NULL'} -> ${r.total} companies`));

        // 3. The actual matching - company_name
        const matchTest = await pool.query(`
            SELECT c.company_name, c.user_id as company_user, l.user_id as lead_user, COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
            GROUP BY c.company_name, c.user_id, l.user_id
            LIMIT 10
        `);
        console.log('\nCompany-Lead matching by company_name (first 10):');
        matchTest.rows.forEach(r => console.log(`  - ${r.company_name}: company_user=${r.company_user}, lead_user=${r.lead_user}, leads=${r.lead_count}`));

        // 4. Check if leads match companies by name only (ignoring user_id)
        const leadsPerCompany = await pool.query(`
            SELECT c.company_name, COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name 
            WHERE l.status != 'DISQUALIFIED' AND c.user_id IS NOT NULL
            GROUP BY c.company_name
            HAVING COUNT(l.id) > 0
            LIMIT 10
        `);
        console.log('\nCompanies with leads (matching by company_name only):');
        leadsPerCompany.rows.forEach(r => console.log(`  - ${r.company_name}: ${r.lead_count} leads`));

        // 5. What should the query be? Using leads_link
        const correctQuery = await pool.query(`
            SELECT c.company_name, COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
            LEFT JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_id = c.user_id AND link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            GROUP BY c.company_name
            HAVING COUNT(l.id) > 0
            LIMIT 10
        `);
        console.log('\nCompanies with leads (using leads_link for user match):');
        correctQuery.rows.forEach(r => console.log(`  - ${r.company_name}: ${r.lead_count} leads`));

        // 6. Check if icp_type is set on companies
        const icpTypes = await pool.query(`
            SELECT icp_type, COUNT(*) as total 
            FROM companies 
            GROUP BY icp_type 
            ORDER BY total DESC
        `);
        console.log('\nCompanies by icp_type:');
        icpTypes.rows.forEach(r => console.log(`  - ${r.icp_type || 'NULL'}: ${r.total}`));

        // 7. Which user is logged in (roelof@elvison.com)
        const user = await pool.query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        const userId = user.rows[0]?.id;
        console.log(`\nUser roelof@elvison.com ID: ${userId}`);

        // 8. How many companies belong to this user?
        const userCompanies = await pool.query(`SELECT COUNT(*) FROM companies WHERE user_id = $1`, [userId]);
        console.log(`Companies for this user: ${userCompanies.rows[0].count}`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

check();
