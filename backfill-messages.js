#!/usr/bin/env node

/**
 * Backfill Script - Generate Missing Connection Requests & Email Messages
 * 
 * This script finds all leads that are missing connection_request or email_message
 * in their custom_data, then uses the Outreach Creator agent to generate them.
 */

import { Agent, Runner } from "@openai/agents";
import { query } from "./db/index.js";
import { createOutreachAgent, OutreachCreatorSchema } from "./src/backend/agent-setup.js";
import { AGENT_MODELS } from "./src/config/workflow.js";

const BATCH_SIZE = 20; // Process 20 leads at a time
const DELAY_BETWEEN_BATCHES = 2000; // 2 second delay to avoid rate limits

async function main() {
    console.log('🔄 Starting backfill for missing connection requests and email messages...\n');

    // 1. Fetch all leads
    const { rows: allLeads } = await query(`
        SELECT id, person_name, job_title, company_name, email, linkedin_url, custom_data
        FROM leads
        WHERE status != 'DISQUALIFIED'
        ORDER BY created_at DESC
    `);

    console.log(`📊 Total leads in system: ${allLeads.length}`);

    // 2. Filter to only leads missing connection_request OR email_message
    const leadsNeedingMessages = allLeads.filter(lead => {
        try {
            const customData = typeof lead.custom_data === 'string'
                ? JSON.parse(lead.custom_data)
                : (lead.custom_data || {});

            const hasConnectionRequest = customData.connection_request && customData.connection_request.trim().length > 0;
            const hasEmailMessage = customData.email_message && customData.email_message.trim().length > 0;
            const hasCompanyProfile = customData.company_profile && customData.company_profile.trim().length > 0;

            // Need messages if missing either one AND has company profile to work with
            return (!hasConnectionRequest || !hasEmailMessage) && hasCompanyProfile;
        } catch (e) {
            console.error(`Error parsing custom_data for lead ${lead.id}:`, e);
            return false;
        }
    });

    console.log(`🎯 Leads needing messages: ${leadsNeedingMessages.length}`);

    if (leadsNeedingMessages.length === 0) {
        console.log('✅ All leads already have connection requests and email messages!');
        process.exit(0);
    }

    // 3. Fetch a sample ICP for instructions (we'll use the first one we find)
    const { rows: icps } = await query(`SELECT id, agent_config FROM icps LIMIT 1`);
    if (icps.length === 0) {
        console.error('❌ No ICPs found in database. Cannot generate messages.');
        process.exit(1);
    }

    const agentConfig = icps[0].agent_config || {};
    const outreachInstructions = agentConfig.outreach_creator_instructions || `
You are an expert copywriter specializing in B2B outreach.

Your task is to create personalized connection requests and email messages for each lead.

For CONNECTION REQUESTS (max 300 characters):
- Be concise and professional
- Reference something specific about their company or role
- Express genuine interest in connecting

For EMAIL MESSAGES:
- Personalize based on their role and company
- Explain why you're reaching out
- Include a clear value proposition
- Keep it concise (max 4 paragraphs)

Use the company profile to add specific, relevant details.
    `.trim();

    console.log('📝 Using outreach instructions from ICP configuration\n');

    // 4. Create Outreach Agent
    const outreachAgent = createOutreachAgent(outreachInstructions, []);
    const runner = new Runner();

    // 5. Process in batches
    const batches = [];
    for (let i = 0; i < leadsNeedingMessages.length; i += BATCH_SIZE) {
        batches.push(leadsNeedingMessages.slice(i, i + BATCH_SIZE));
    }

    console.log(`🔄 Processing ${batches.length} batches of up to ${BATCH_SIZE} leads each...\n`);

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        console.log(`\n📦 Batch ${batchIdx + 1}/${batches.length} (${batch.length} leads)...`);

        try {
            // Prepare input for Outreach Creator
            const leadsForAgent = batch.map(lead => {
                const customData = typeof lead.custom_data === 'string'
                    ? JSON.parse(lead.custom_data)
                    : (lead.custom_data || {});

                return {
                    date_added: new Date().toISOString().split('T')[0],
                    first_name: lead.person_name?.split(' ')[0] || '',
                    last_name: lead.person_name?.split(' ').slice(1).join(' ') || '',
                    company_name: lead.company_name || '',
                    title: lead.job_title || '',
                    email: lead.email || '',
                    linkedin_url: lead.linkedin_url || '',
                    company_website: customData.company_website || '',
                    connection_request: customData.connection_request || '',
                    email_message: customData.email_message || '',
                    company_profile: customData.company_profile || ''
                };
            });

            const input = `
Here are ${batch.length} leads that need personalized outreach content.
For each lead, generate a connection request and email message.

${JSON.stringify({ leads: leadsForAgent }, null, 2)}
            `.trim();

            // Run Outreach Creator
            const result = await runner.run(outreachAgent, input);

            if (result.finalOutput && result.finalOutput.leads) {
                const generatedLeads = result.finalOutput.leads;

                // Update each lead in the database
                for (let i = 0; i < batch.length; i++) {
                    const originalLead = batch[i];
                    const generatedLead = generatedLeads[i];

                    if (!generatedLead) {
                        console.warn(`  ⚠️  No output for lead ${originalLead.id} (${originalLead.person_name})`);
                        totalErrors++;
                        continue;
                    }

                    try {
                        // Merge with existing custom_data
                        const existingCustomData = typeof originalLead.custom_data === 'string'
                            ? JSON.parse(originalLead.custom_data)
                            : (originalLead.custom_data || {});

                        const updatedCustomData = {
                            ...existingCustomData,
                            connection_request: generatedLead.connection_request || existingCustomData.connection_request || '',
                            email_message: generatedLead.email_message || existingCustomData.email_message || ''
                        };

                        // Update in database
                        await query(`
                            UPDATE leads 
                            SET custom_data = $1
                            WHERE id = $2
                        `, [JSON.stringify(updatedCustomData), originalLead.id]);

                        console.log(`  ✅ Updated lead ${originalLead.id} (${originalLead.person_name})`);
                        totalSuccess++;
                    } catch (updateErr) {
                        console.error(`  ❌ Failed to update lead ${originalLead.id}:`, updateErr.message);
                        totalErrors++;
                    }
                }

                totalProcessed += batch.length;
                console.log(`  📊 Batch complete: ${totalSuccess}/${totalProcessed} successful`);
            } else {
                console.error(`  ❌ Batch ${batchIdx + 1} returned invalid output`);
                totalErrors += batch.length;
            }

        } catch (batchErr) {
            console.error(`❌ Batch ${batchIdx + 1} failed:`, batchErr.message);
            totalErrors += batch.length;
        }

        // Delay between batches to avoid rate limits
        if (batchIdx < batches.length - 1) {
            console.log(`  ⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total leads processed: ${totalProcessed}`);
    console.log(`✅ Successfully updated: ${totalSuccess}`);
    console.log(`❌ Errors: ${totalErrors}`);
    console.log('='.repeat(60) + '\n');

    process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
});
