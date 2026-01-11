
import { query } from './db/index.js';

async function run() {
    try {
        const { rows } = await query(`
            SELECT id, company_name, website, icp_type, fit_score, status, cleanup_status
            FROM companies 
            WHERE cleanup_status = 'REVIEW_REQUIRED'
            ORDER BY company_name ASC
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}
run();
