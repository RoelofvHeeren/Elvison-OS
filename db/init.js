import { query, getClient } from './index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function initDb() {
    console.log('Initializing database...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            await client.query(schema);

            // Run Migration 05
            const migration05Path = path.join(__dirname, 'migrations', '05_company_tracking.sql');
            if (fs.existsSync(migration05Path)) {
                const migration05 = fs.readFileSync(migration05Path, 'utf8');
                await client.query(migration05);
                console.log('Migration 05 applied.');
            }

            // Run Migration 11 - Add company_profile
            const migration11Path = path.join(__dirname, 'migrations', '11_add_company_profile.sql');
            if (fs.existsSync(migration11Path)) {
                const migration11 = fs.readFileSync(migration11Path, 'utf8');
                await client.query(migration11);
                console.log('Migration 11 applied.');
            }

            await client.query('COMMIT');
            console.log('Database schema applied successfully.');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('Failed to apply schema:', e);
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Database connection failed:', err);
        process.exit(1);
    }
}

initDb();
