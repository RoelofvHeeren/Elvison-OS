import { aimfoxService } from './src/backend/services/aimfox.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const testPush = async () => {
    // Lead: Roelof van Heeren (restored ID)
    const lead = {
        person_name: 'Roelof van Heeren',
        company_name: 'Elvison Foundations',
        email: 'Roelof@elvison.com',
        job_title: 'Founder',
        linkedin_url: 'https://www.linkedin.com/in/roelof-van-heeren-013a73230/',
        custom_data: {
            company_profile: 'TEST PROFILE',
            connection_request: 'TEST CONNECTION REQUEST',
            email_message: 'TEST EMAIL'
        }
    };

    const campaignId = 'e00e94fd-82dd-4015-a5aa-421f96240906'; // AI Elvison OS Test

    console.log(`Pushing ${lead.person_name} to campaign ${campaignId}...`);

    try {
        const result = await aimfoxService.addLeadToCampaign(campaignId, lead);
        console.log('Push Success:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Push Failed:', error.response ? error.response.data : error.message);
    }
};

testPush();
