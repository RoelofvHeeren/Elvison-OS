import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectLinkTables() {
    console.log('🔍 Inspecting Link Table Columns...\n');
    try {
        const linkTables = [
            'agent_prompts_link',
            'lead_feedback_link',
            'leads_link',
            'workflow_runs_link_table'
        ];

        for (const tableName of linkTables) {
            const columnsResult = await pool.query(`
                SELECT column_name, data_type, udt_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                    AND table_name = $1
                ORDER BY ordinal_position;
            `, [tableName]);

            console.log(`\n📋 ${tableName}:`);
            if (columnsResult.rows.length === 0) {
                console.log("   (Table not found or no columns)");
            }
            columnsResult.rows.forEach(col => {
                console.log(`   - ${col.column_name}: ${col.data_type} (${col.udt_name})`);
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}
inspectLinkTables();
