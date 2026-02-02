
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const { Client } = pg;
const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const client = new Client({
    connectionString: envConfig.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'workflow_runs'
        `);
        console.log("Columns in 'workflow_runs':", res.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
checkSchema();
