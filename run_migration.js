import { query } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigration = async () => {
    try {
        const migrationPath = path.join(__dirname, 'db', 'migrations', '02_system_config.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log('Running migration: 02_system_config.sql');
        await query(sql);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
};

runMigration();
