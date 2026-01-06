/**
 * Cleanup Script: Remove leads without company_profile
 * These are leads from companies that were never properly profiled/qualified
 */

async function cleanupLeadsWithoutProfile() {
    console.log('🧹 Cleaning up leads without company_profile...');

    // Fallback for local dev
    if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:51214/postgres";
    }

    try {
        const { query: dbQuery } = await import('./db/index.js');

        // 1. Count leads without company_profile
        const countRes = await dbQuery(`
            SELECT COUNT(*) as count FROM leads 
            WHERE custom_data->>'company_profile' IS NULL 
               OR custom_data->>'company_profile' = ''
               OR custom_data->>'company_profile' = 'null'
               OR LENGTH(custom_data->>'company_profile') < 50
        `);
        console.log(`Found ${countRes.rows[0].count} leads without valid company_profile`);

        // 2. Show sample of what we're deleting
        const sampleRes = await dbQuery(`
            SELECT id, email, company_name, custom_data->>'company_profile' as profile
            FROM leads 
            WHERE custom_data->>'company_profile' IS NULL 
               OR custom_data->>'company_profile' = ''
               OR custom_data->>'company_profile' = 'null'
               OR LENGTH(custom_data->>'company_profile') < 50
            LIMIT 10
        `);
        console.log('\n📋 Sample leads being deleted:');
        sampleRes.rows.forEach(r => {
            const profileSnippet = r.profile ? r.profile.substring(0, 30) + '...' : '(empty)';
            console.log(`  - ${r.email} @ ${r.company_name} | Profile: ${profileSnippet}`);
        });

        // 3. Delete leads without valid company_profile
        const deleteRes = await dbQuery(`
            DELETE FROM leads 
            WHERE custom_data->>'company_profile' IS NULL 
               OR custom_data->>'company_profile' = ''
               OR custom_data->>'company_profile' = 'null'
               OR LENGTH(custom_data->>'company_profile') < 50
            RETURNING id
        `);
        console.log(`\n✅ Deleted ${deleteRes.rows.length} leads without valid company_profile`);

        // 4. Show remaining lead count
        const remainingRes = await dbQuery(`SELECT COUNT(*) as count FROM leads`);
        console.log(`\n📊 Remaining leads in CRM: ${remainingRes.rows[0].count}`);

        console.log('\n✨ Cleanup Complete!');

    } catch (err) {
        console.error('❌ Cleanup Error:', err);
    }
}

cleanupLeadsWithoutProfile();
