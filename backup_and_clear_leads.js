import { query } from './db/index.js';
import fs from 'fs';

async function backupAndClear() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `./leads_backup_${timestamp}.json`;

    console.log(`📦 Starting backup of 'leads' table...`);

    try {
        // 1. Fetch all leads
        const { rows: leads } = await query('SELECT * FROM leads');
        console.log(`Found ${leads.length} leads.`);

        // 2. Save to file
        fs.writeFileSync(backupFile, JSON.stringify(leads, null, 2));
        console.log(`✅ Backup saved to ${backupFile}`);

        // 3. Optional: Clear table
        console.log(`⚠️  CLEARING 'leads' table...`);
        await query('TRUNCATE TABLE leads CASCADE');
        console.log(`✅ Table 'leads' cleared successfully.`);

    } catch (err) {
        console.error('❌ Error during backup/clear:', err);
    }
}

backupAndClear();
