import dotenv from 'dotenv';
import pg from 'pg';
import { OutreachService } from './src/backend/services/outreach-service.js';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixMissingMessages() {
    console.log('🔧 Starting Message Fix Script...\n');

    try {
        // 1. Identify leads with missing/skipped messages
        const targetLeads = await pool.query(`
            SELECT id, company_name, person_name, job_title 
            FROM leads 
            WHERE email_message IS NULL 
               OR email_message LIKE '%[SKIPPED]%'
               OR outreach_status = 'SKIP'
        `);

        if (targetLeads.rows.length === 0) {
            console.log('✅ No leads need fixing.');
            return;
        }

        console.log(`🎯 Found ${targetLeads.rows.length} leads to fix.`);

        // 2. Fetch all company profiles source of truth
        const companiesRes = await pool.query(`
            SELECT company_name, company_profile 
            FROM companies 
            WHERE company_profile IS NOT NULL
        `);

        // Create a map for fast lookup: company_name -> profile
        // Normalize names to lower case for matching
        const profileMap = {};
        companiesRes.rows.forEach(c => {
            profileMap[c.company_name.toLowerCase().trim()] = c.company_profile;
        });

        console.log(`📚 Loaded ${Object.keys(profileMap).length} company profiles.`);

        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        // 3. Process each lead
        for (const lead of targetLeads.rows) {
            const companyNameLower = lead.company_name.toLowerCase().trim();
            const profile = profileMap[companyNameLower];

            if (!profile) {
                console.log(`⚠️  No profile found for company: "${lead.company_name}" (Lead: ${lead.person_name}). Skipping.`);
                skippedCount++;
                continue;
            }

            // Update lead's profile in DB first (for consistency)
            await pool.query('UPDATE leads SET company_profile = $1 WHERE id = $2', [profile, lead.id]);

            // Regenerate Message
            const firstName = lead.person_name.split(' ')[0];
            const result = await OutreachService.createLeadMessages({
                company_name: lead.company_name,
                company_profile: profile,
                person_name: lead.person_name,
                first_name: firstName,
                icp_type: 'Real Estate Investor' // Default assuming these are the target
            });

            if (result.outreach_status !== 'SUCCESS') {
                console.log(`❌ Failed to generate for ${lead.person_name} (${lead.company_name}): ${result.outreach_status} - ${result.outreach_reason}`);
                failCount++;

                // Update status to reflect failure but keep the profile
                await pool.query(`
                    UPDATE leads 
                    SET status = 'QUALIFICATION_FAILED', 
                        outreach_status = $2,
                        outreach_reason = $3
                    WHERE id = $1
                `, [lead.id, result.outreach_status, result.outreach_reason]);

            } else {
                // Success! Update everything
                await pool.query(`
                    UPDATE leads 
                    SET status = 'NEW',
                        outreach_status = 'SUCCESS',
                        email_message = $2,
                        email_subject = $3,
                        connection_request = $4,
                        research_fact = $5,
                        research_fact_type = $6
                    WHERE id = $1
                `, [
                    lead.id,
                    result.email_body,
                    result.email_subject,
                    result.linkedin_message,
                    result.research_fact,
                    result.research_fact_type
                ]);
                successCount++;
                // console.log(`✅ Fixed: ${lead.person_name} (${lead.company_name})`);
            }

            // Progress indicator every 50
            if ((successCount + failCount + skippedCount) % 50 === 0) {
                console.log(`   Processed ${successCount + failCount + skippedCount}/${targetLeads.rows.length}...`);
            }
        }

        console.log('\n🏁 Fix Complete!');
        console.log(`✅ Successfully generated: ${successCount}`);
        console.log(`❌ Failed gen (gates/AI): ${failCount}`);
        console.log(`⚠️  Skipped (no profile): ${skippedCount}`);

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        await pool.end();
    }
}

fixMissingMessages();
