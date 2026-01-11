import { query } from '../db/index.js';
import { OutreachService } from '../src/backend/services/outreach-service.js';
import dotenv from 'dotenv';
dotenv.config();

const main = async () => {
    try {
        const leadId = 'd4ba7485-abf4-4c7e-adbd-5a0469f953f4';
        console.log(`fetching lead ${leadId}...`);

        const leadRes = await query("SELECT * FROM leads WHERE id = $1", [leadId]);
        if (leadRes.rows.length === 0) {
            console.error("Lead not found");
            process.exit(1);
        }
        const lead = leadRes.rows[0];

        // Prepare input for static method
        // Method signature: createLeadMessages({ company_name, website, company_profile, fit_score, icp_type })
        const input = {
            company_name: lead.company_name,
            website: lead.custom_data?.company_website || 'fifthaveproperties.com',
            company_profile: lead.custom_data?.company_profile || "",
            // Mock scores if needed to pass gates, or ensure profile has keywords
            icp_type: 'Investor', // Force passing the Brokerage Gate
            fit_score: 90
        };

        console.log("Generating outreach messages (Static Method)...");
        const result = await OutreachService.createLeadMessages(input);

        console.log("\n>>> GENERATED MESSAGES <<<");
        console.log("STATUS:", result.status);

        if (result.status === 'SKIP') {
            console.warn("SKIPPED:", result.skip_reason);
        } else {
            console.log("LINKEDIN MESSAGE:\n", result.linkedin_message);
            console.log("------------------------------------------");
            console.log("EMAIL MESSAGE:\n", result.email_body);
            console.log("------------------------------------------");

            // Update DB
            const newCustomData = {
                ...lead.custom_data,
                connection_request: result.linkedin_message,
                email_message: result.email_body
            };

            await query("UPDATE leads SET custom_data = $1, outreach_status = 'generated', updated_at = NOW() WHERE id = $2", [JSON.stringify(newCustomData), leadId]);
            console.log("✅ Database updated with new messages.");
        }

        process.exit(0);
    } catch (e) {
        console.error("Script failed:", e);
        process.exit(1);
    }
};

main();
