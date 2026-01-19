// Check leads_link table structure and contents
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function check() {
    try {
        console.log('🔍 Checking leads_link table...\n');

        // 1. Table structure
        const columns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'leads_link'
            ORDER BY ordinal_position
        `);
        console.log('leads_link columns:');
        columns.rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

        // 2. Count
        const count = await pool.query('SELECT COUNT(*) FROM leads_link');
        console.log(`\nTotal rows in leads_link: ${count.rows[0].count}`);

        // 3. Sample rows
        const samples = await pool.query('SELECT * FROM leads_link LIMIT 5');
        console.log(`\nSample rows:`);
        samples.rows.forEach(r => console.log(`  - lead_id: ${r.lead_id}, parent_id: ${r.parent_id}, parent_type: ${r.parent_type}`));

        // 4. Check users table
        const users = await pool.query('SELECT id, email FROM users');
        console.log(`\nUsers in system:`);
        users.rows.forEach(r => console.log(`  - ${r.id}: ${r.email}`));

        // 5. Check if leads_link parent_ids match users
        const matchingLinks = await pool.query(`
            SELECT COUNT(*) FROM leads_link ll
            JOIN users u ON ll.parent_id = u.id
            WHERE ll.parent_type = 'user'
        `);
        console.log(`\nLeads linked to valid users: ${matchingLinks.rows[0].count}`);

        // 6. Check ICPs table structure
        const icpColumns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'icps'
            ORDER BY ordinal_position
        `);
        console.log(`\nICPs table columns:`);
        icpColumns.rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

        // 7. Sample ICPs
        const icpSamples = await pool.query('SELECT id, name FROM icps LIMIT 5');
        console.log(`\nSample ICPs:`);
        icpSamples.rows.forEach(r => console.log(`  - ${r.name} (${r.id})`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

check();
