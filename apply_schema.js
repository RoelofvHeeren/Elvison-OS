import { query } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const applySchema = async () => {
    try {
        console.log('Applying schema...');
        const schemaPath = path.join(__dirname, 'db', 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolon to execute mostly safely, or just run whole block if pg supports it (it usually does for simple DDL)
        // However, pg driver query() usually handles multiple statements.

        await query(schemaSql);

        // Manual migration for existing table modification if needed
        // ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);
        // ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id);`);
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);`);
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS fund_id UUID REFERENCES funds(id);`);

        console.log('✅ Schema applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Schema application failed:', err);
        process.exit(1);
    }
};

applySchema();
