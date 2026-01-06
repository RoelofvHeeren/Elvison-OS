/**
 * Cleanup Script: Remove invalid leads with @linktr.ee emails
 * These are Linktree profile scrapes, not real company contacts
 */

async function cleanupInvalidLeads() {
    console.log('🧹 Starting CRM Cleanup...');

    // Fallback for local dev
    if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:51214/postgres";
    }

    try {
        const { query: dbQuery } = await import('./db/index.js');

        // 1. Count leads with @linktr.ee emails
        const countRes = await dbQuery(`
            SELECT COUNT(*) as count FROM leads 
            WHERE email LIKE '%@linktr.ee'
        `);
        console.log(`Found ${countRes.rows[0].count} leads with @linktr.ee emails`);

        // 2. Show sample of what we're deleting
        const sampleRes = await dbQuery(`
            SELECT id, email, company_name, person_name 
            FROM leads 
            WHERE email LIKE '%@linktr.ee'
            LIMIT 10
        `);
        console.log('\n📋 Sample leads being deleted:');
        sampleRes.rows.forEach(r => {
            console.log(`  - ${r.person_name} (${r.email}) @ ${r.company_name}`);
        });

        // 3. Delete all @linktr.ee leads
        const deleteRes = await dbQuery(`
            DELETE FROM leads 
            WHERE email LIKE '%@linktr.ee'
            RETURNING id
        `);
        console.log(`\n✅ Deleted ${deleteRes.rows.length} invalid leads with @linktr.ee emails`);

        // 4. Also clean up any leads with other known fake/generic email domains
        const BLOCKED_DOMAINS = ['linktree.com', 'example.com', 'test.com', 'temp-mail.org'];
        for (const domain of BLOCKED_DOMAINS) {
            const delRes = await dbQuery(`
                DELETE FROM leads 
                WHERE email LIKE $1
                RETURNING id
            `, [`%@${domain}`]);
            if (delRes.rows.length > 0) {
                console.log(`✅ Deleted ${delRes.rows.length} leads with @${domain} emails`);
            }
        }

        // 5. Show remaining lead count
        const remainingRes = await dbQuery(`SELECT COUNT(*) as count FROM leads`);
        console.log(`\n📊 Remaining leads in CRM: ${remainingRes.rows[0].count}`);

        console.log('\n✨ Cleanup Complete!');

    } catch (err) {
        console.error('❌ Cleanup Error:', err);
    }
}

cleanupInvalidLeads();
