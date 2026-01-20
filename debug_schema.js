
import { query } from './db/index.js';

async function checkSchema() {
    try {
        const leadsLinkColumns = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'leads_link'
        `);
        console.log('leads_link columns:', leadsLinkColumns.rows.map(r => r.column_name));

        const leadsColumns = await query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'leads'
        `);
        console.log('leads columns:', leadsColumns.rows.map(r => r.column_name));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkSchema();
