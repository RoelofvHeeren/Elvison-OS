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
