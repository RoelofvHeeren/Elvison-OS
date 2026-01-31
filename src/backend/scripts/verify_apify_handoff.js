
import { query, pool } from '../../../db/index.js';

async function checkCompanies() {
    try {
        const domains = ['woodbourneinvestments.com', 'pier4.ca', 'dancap.ca', 'claridgeinc.com', 'flippa.com'];
        console.log('Checking for domains:', domains);

        const res = await query(`
            SELECT company_name, website, created_at, fit_score, company_profile 
            FROM companies 
            WHERE website = ANY($1) 
            ORDER BY created_at DESC;
        `, [domains]);

        console.log('Found companies in DB:', res.rows.length);
        res.rows.forEach(r => {
            console.log(`- ${r.company_name} (${r.website}): Score ${r.fit_score}, Created: ${r.created_at}`);
        });

        if (res.rows.length === 0) {
            console.log('❌ No companies found from the recent log batch.');
        } else {
            console.log('✅ Handoff seems to be working for at least some companies.');
        }

        // Also check if any are missing
        const foundDomains = res.rows.map(r => r.website);
        const missing = domains.filter(d => !foundDomains.includes(d));
        console.log('Missing domains:', missing);

    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await pool.end();
    }
}

checkCompanies();
