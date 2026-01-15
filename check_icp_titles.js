import { query } from './db/index.js';

async function checkIcpTitles() {
    try {
        const result = await query(`
            SELECT id, name, config 
            FROM icps 
            WHERE user_id = (SELECT id FROM users LIMIT 1)
        `);

        console.log('\n=== ICP Configurations ===\n');

        for (const icp of result.rows) {
            console.log(`\n📋 ICP: ${icp.name} (ID: ${icp.id})`);
            console.log('Config:', JSON.stringify(icp.config, null, 2));

            if (icp.config?.job_titles) {
                console.log(`Job Titles: ${icp.config.job_titles.join(', ')}`);
            } else {
                console.log('⚠️  NO JOB TITLES CONFIGURED - Will use defaults');
            }

            if (icp.config?.seniority) {
                console.log(`Seniority: ${icp.config.seniority.join(', ')}`);
            }
        }

        console.log('\n\n=== Default Titles (from lead-scraper-service.js) ===');
        console.log('["ceo", "founder", "owner", "partner", "president", "director", "vp", "head", "principal", "executive"]');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}

checkIcpTitles();
