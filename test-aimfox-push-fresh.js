import { aimfoxService } from './src/backend/services/aimfox.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const testPushFresh = async () => {
    // Generate a quick random ID to avoid locking
    const randomId = Math.floor(Math.random() * 100000);
    const lead = {
        person_name: `Test User ${randomId}`,
        company_name: 'Test Company',
        email: `test${randomId}@example.com`,
        job_title: 'Tester',
        linkedin_url: `https://www.linkedin.com/in/test-user-${randomId}/`,
        custom_data: {
            company_profile: 'TEST PROFILE FOR FRESH LEAD',
            connection_request: 'TEST CONN REQ',
            email_message: 'TEST EMAIL MSG'
        }
    };

    const campaignId = 'e00e94fd-82dd-4015-a5aa-421f96240906'; // AI Elvison OS Test

    console.log(`Pushing FRESH lead ${lead.person_name} to campaign ${campaignId}...`);

    try {
        const result = await aimfoxService.addLeadToCampaign(campaignId, lead);
        console.log('Push Success:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Push Failed:', error.response ? error.response.data : error.message);
    }
};

testPushFresh();
