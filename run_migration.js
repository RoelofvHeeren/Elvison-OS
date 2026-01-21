import { query } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigration = async () => {
    try {
        const migrationFile = '33_delete_orphaned_disqualified.sql'; // Update this to run different migrations
        const migrationPath = path.join(__dirname, 'db', 'migrations', migrationFile);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log(`Running migration: ${migrationFile}`);
        await query(sql);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
};

runMigration();
