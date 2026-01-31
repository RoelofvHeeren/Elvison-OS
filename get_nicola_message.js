import { query } from './db/index.js';
import { OutreachService } from './src/backend/services/outreach-service.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Fetch enriched data for Nicola Wealth and generate message for Peter
 */
async function generateForNicola() {
    console.log('=== Nicola Wealth Outreach Generation ===');

    try {
        // 1. Fetch from DB
        const { rows } = await query(
            `SELECT company_name, company_profile, investment_thesis, custom_data 
             FROM leads 
             WHERE company_name ILIKE $1 
             ORDER BY updated_at DESC LIMIT 1`,
            ['%Nicola Wealth%']
        );

        if (rows.length === 0) {
            console.error('❌ Nicola Wealth not found in DB. Enrichment might have failed silently.');
            process.exit(1);
        }

        const lead = rows[0];
        const customData = lead.custom_data || {};
        const deals = customData.portfolio_deals || [];

        console.log(`\n🔍 Found Data for: ${lead.company_name}`);
        console.log(`Thesis: "${lead.investment_thesis || 'N/A'}"`);
        console.log(`Deals Found: ${deals.length}`);
        if (deals.length > 0) console.log(`Top Deal: ${deals[0].name}`);

        // 2. Generate Message
        console.log(`\n📝 Generating Message for Peter...`);
        const messageResult = await OutreachService.createLeadMessages({
            company_name: lead.company_name,
            website: 'nicolawealth.com',
            company_profile: lead.company_profile,
            icp_type: 'Investment Fund',
            first_name: 'Peter',
            person_name: 'Peter',
            portfolio_deals: deals,
            investment_thesis: lead.investment_thesis
        });

        console.log('\n=== FINAL OUTREACH ===');
        if (messageResult.outreach_status === 'SUCCESS') {
            console.log('\n[LinkedIn Message]:');
            console.log(messageResult.linkedin_message);
            console.log('\n[Email Subject]:');
            console.log(messageResult.email_subject);
            console.log('\n[Email Body]:');
            console.log(messageResult.email_body);
        } else {
            console.log('❌ Failed:', messageResult.outreach_reason);
        }

    } catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}

generateForNicola();
