import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function executeCleanup() {
    console.log('🗑️  Executing company cleanup...\n');

    try {
        // Load triage results
        const triage = JSON.parse(fs.readFileSync('triage_results.json', 'utf8'));

        // Add the 3 uncategorized to delete list
        const toDelete = [
            ...triage.to_delete,
            'Claridge Inc',
            'KKR Real Estate Select Trust',
            'Prologis'
        ];

        console.log(`Will delete ${toDelete.length} companies:\n`);
        toDelete.forEach(name => console.log(`  - ${name}`));
        console.log('');

        // Delete leads_link entries first (foreign key constraint)
        const { rows: leadsToDelete } = await pool.query(`
            SELECT id, person_name, company_name 
            FROM leads 
            WHERE company_name = ANY($1::text[])
        `, [toDelete]);

        console.log(`Found ${leadsToDelete.length} leads to delete\n`);

        // Delete from leads_link
        await pool.query(`
            DELETE FROM leads_link 
            WHERE lead_id IN (
                SELECT id FROM leads WHERE company_name = ANY($1::text[])
            )
        `, [toDelete]);

        console.log('✅ Deleted from leads_link');

        // Delete from leads
        await pool.query(`
            DELETE FROM leads WHERE company_name = ANY($1::text[])
        `, [toDelete]);

        console.log('✅ Deleted from leads');

        // Delete from companies
        await pool.query(`
            DELETE FROM companies WHERE company_name = ANY($1::text[])
        `, [toDelete]);

        console.log('✅ Deleted from companies\n');

        // Verify remaining counts
        const { rows: [counts] } = await pool.query(`
            SELECT 
                COUNT(DISTINCT c.company_name) as companies,
                COUNT(l.id) as leads
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
        `);

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 CLEANUP COMPLETE');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log(`Deleted: ${toDelete.length} companies, ${leadsToDelete.length} leads`);
        console.log(`Remaining: ${counts.companies} companies, ${counts.leads} leads\n`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

executeCleanup();
