import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkDatabaseState() {
    console.log('🔍 Checking Database State...\n');

    try {
        // Check which tables exist
        console.log('📋 EXISTING TABLES:');
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        tablesResult.rows.forEach(row => console.log(`  ✓ ${row.table_name}`));

        // Check existing foreign key constraints
        console.log('\n🔗 EXISTING FOREIGN KEY CONSTRAINTS:');
        const fkResult = await pool.query(`
            SELECT 
                tc.constraint_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);
        fkResult.rows.forEach(row => {
            console.log(`  ✓ ${row.constraint_name}: ${row.table_name}.${row.column_name} → ${row.foreign_table_name}.${row.foreign_column_name}`);
        });

        // Check link tables structure
        console.log('\n🔗 LINK TABLES STRUCTURE:');
        const linkTables = ['agent_prompts_link', 'lead_feedback_link', 'leads_link', 'workflow_runs_link'];

        for (const tableName of linkTables) {
            const exists = tablesResult.rows.some(row => row.table_name === tableName);
            if (exists) {
                const columnsResult = await pool.query(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                        AND table_name = $1
                    ORDER BY ordinal_position;
                `, [tableName]);

                console.log(`\n  ${tableName}:`);
                columnsResult.rows.forEach(col => {
                    console.log(`    - ${col.column_name}: ${col.data_type}`);
                });
            } else {
                console.log(`\n  ${tableName}: ❌ Does not exist`);
            }
        }

        // Check for specific missing constraints mentioned in the audit
        console.log('\n🔍 CHECKING SPECIFIC CONSTRAINTS FROM AUDIT:');
        const constraintsToCheck = [
            'fk_agent_prompts_link_table_agent_prompt_id',
            'fk_lead_feedback_link_table_lead_feedback_id',
            'fk_leads_link_table_lead_id',
            'fk_workflow_runs_link_table_workflow_run_id'
        ];

        for (const constraintName of constraintsToCheck) {
            const exists = fkResult.rows.some(row => row.constraint_name === constraintName);
            console.log(`  ${exists ? '✓' : '❌'} ${constraintName}`);
        }

        console.log('\n✅ Database state check complete!');

    } catch (error) {
        console.error('❌ Error checking database state:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

checkDatabaseState();
