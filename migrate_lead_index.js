
import { query } from './db/index.js';

async function migrate() {
    try {
        console.log('🚀 Running lead index migration...');

        // Drop old partial index if exists
        await query(`DROP INDEX IF EXISTS idx_leads_linkedin_url;`);

        // Add standard unique index on linkedin_url for leads
        // Note: Multiple NULLs are allowed in Postgres UNIQUE indexes
        await query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_linkedin_url 
            ON leads (linkedin_url) 
            WHERE linkedin_url IS NOT NULL AND linkedin_url != '';
        `);

        console.log('✅ Unique index created successfully.');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    }
}

migrate();
