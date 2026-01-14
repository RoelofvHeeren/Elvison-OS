import { aimfoxService } from './src/backend/services/aimfox.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const testPushEvan = async () => {
    const lead = {
        person_name: 'Evan Klijn',
        company_name: 'Klijn Enterprises',
        email: 'evan@klijn.com',
        job_title: 'Director',
        linkedin_url: 'https://www.linkedin.com/in/evan-klijn-463a121a9/',
        custom_data: {
            company_website: 'https://klijn.com',
            company_profile: 'Klijn Enterprises focuses on sustainable tech.',
            connection_request: 'Hi Evan, wanted to connect.',
            email_message: 'Hi Evan, reaching out regarding your work.'
        }
    };

    const campaignId = 'e00e94fd-82dd-4015-a5aa-421f96240906'; // AI Elvison OS Test

    console.log(`Pushing Evan Klijn to campaign ${campaignId}...`);

    try {
        const result = await aimfoxService.addLeadToCampaign(campaignId, lead);
        console.log('Push Success:', JSON.stringify(result, null, 2));

        if (result.failed && result.failed.length > 0) {
            console.log('NOTE: Push reported failures.');
        } else {
            console.log('Lead added cleanly.');
        }

    } catch (error) {
        console.error('Push Failed:', error.response ? error.response.data : error.message);
    }
};

testPushEvan();
