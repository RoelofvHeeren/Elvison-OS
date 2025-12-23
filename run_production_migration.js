import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runProductionMigration = async () => {
    // Use production DATABASE_URL from .env
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ ERROR: DATABASE_URL not found in environment variables');
        console.log('Please ensure your .env file contains the production DATABASE_URL');
        process.exit(1);
    }

    console.log('🔗 Connecting to production database...');
    console.log(`   Database: ${databaseUrl.split('@')[1]?.split('/')[0] || 'hidden'}`);

    const client = new pg.Client({
        connectionString: databaseUrl,
        ssl: {
            rejectUnauthorized: false // Required for Railway/Heroku
        }
    });

    try {
        await client.connect();
        console.log('✅ Connected to production database\n');

        const migrationFile = '05_company_tracking.sql';
        const migrationPath = path.join(__dirname, 'db', 'migrations', migrationFile);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log(`📋 Running migration: ${migrationFile}`);
        console.log('─'.repeat(60));

        const result = await client.query(sql);

        console.log('─'.repeat(60));
        console.log('✅ Migration completed successfully!\n');

        if (result.rows && result.rows.length > 0) {
            console.log('Result:', result.rows[0].result);
        }

        // Verify table was created
        const checkTable = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'researched_companies'
            );
        `);

        if (checkTable.rows[0].exists) {
            console.log('\n✅ Verified: researched_companies table exists');

            // Get table info
            const tableInfo = await client.query(`
                SELECT 
                    column_name, 
                    data_type, 
                    is_nullable, 
                    column_default
                FROM information_schema.columns
                WHERE table_name = 'researched_companies'
                ORDER BY ordinal_position;
            `);

            console.log('\n📊 Table Structure:');
            console.log('─'.repeat(80));
            console.log('Column'.padEnd(25), 'Type'.padEnd(20), 'Nullable'.padEnd(10), 'Default');
            console.log('─'.repeat(80));
            tableInfo.rows.forEach(col => {
                console.log(
                    col.column_name.padEnd(25),
                    col.data_type.padEnd(20),
                    col.is_nullable.padEnd(10),
                    (col.column_default || '').substring(0, 30)
                );
            });
            console.log('─'.repeat(80));

            // Check indexes
            const indexes = await client.query(`
                SELECT indexname, indexdef 
                FROM pg_indexes 
                WHERE tablename = 'researched_companies';
            `);

            console.log('\n🔑 Indexes Created:');
            console.log('─'.repeat(80));
            indexes.rows.forEach(idx => {
                console.log(`  • ${idx.indexname}`);
            });
            console.log('─'.repeat(80));
        } else {
            console.log('❌ ERROR: Table was not created');
        }

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        console.error('\nFull error:', err);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n🔌 Database connection closed');
    }
};

console.log('🚀 Production Database Migration Runner');
console.log('═'.repeat(60));
runProductionMigration();
