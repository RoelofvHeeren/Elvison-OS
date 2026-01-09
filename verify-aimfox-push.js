
import { aimfoxService } from './src/backend/services/aimfox.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// FORCE KEY FOR VERIFICATION
aimfoxService.apiKey = 'b36561c3-b06f-4461-b88c-945502e623d3';
aimfoxService.baseUrl = 'https://api.aimfox.com/api/v2';

async function verifyPush() {
    console.log('🚀 Starting Aimfox Push Verification...');

    try {
        // 1. List Campaigns
        console.log('\n--- 1. Fetching Campaigns ---');
        const campaigns = await aimfoxService.listCampaigns();
        console.log(`Found ${campaigns.length} campaigns.`);

        if (campaigns.length === 0) {
            console.warn('⚠️ No campaigns found. Cannot test push.');
            return;
        }

        const targetCampaign = campaigns[0];
        console.log(`Targeting Campaign: "${targetCampaign.name}" (ID: ${targetCampaign.id})`);

        // 2. Push Test Lead
        console.log('\n--- 2. Pushing Test Lead ---');
        const testLead = {
            person_name: 'Automated Tester',
            company_name: 'Test Corp',
            job_title: 'Tester',
            email: 'test.aimfox@example.com',
            linkedin_url: 'https://www.linkedin.com/in/test-profile-123456789/',
            custom_data: {
                company_profile: 'This is a test company profile.',
                connection_request: 'Hi, verify connection.',
                email_message: 'Hi, verify email.'
            }
        };

        const result = await aimfoxService.addLeadToCampaign(targetCampaign.id, testLead);
        console.log('✅ Success! Lead pushed to Aimfox.');
        console.log('Result:', result);

    } catch (err) {
        console.error('❌ Verification Failed:', err.message);
        if (err.response) {
            console.error('API Error:', JSON.stringify(err.response.data, null, 2));
        }
    }
}

verifyPush();
