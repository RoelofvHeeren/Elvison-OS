import { aimfoxService } from './src/backend/services/aimfox.js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const testPushSimple = async () => {
    const randomId = Math.floor(Math.random() * 100000);
    const lead = {
        person_name: `Simple User ${randomId}`,
        company_name: 'Simple Co',
        email: `simple${randomId}@example.com`,
        job_title: 'Simplifier',
        linkedin_url: `https://www.linkedin.com/in/simple-user-${randomId}/`,
        // NO custom_data
    };

    const campaignId = 'e00e94fd-82dd-4015-a5aa-421f96240906';

    // Variations to try
    const variations = [
        {
            name: "Valid Type, NO Custom Vars",
            payload: {
                type: 'profile_url',
                profiles: [{ profile_url: lead.linkedin_url }]
            }
        },
        {
            name: "Valid Type, WITH Custom Vars",
            payload: {
                type: 'profile_url',
                profiles: [{
                    profile_url: lead.linkedin_url,
                    custom_variables: { note: "test" }
                }]
            }
        },

    ];

    for (const v of variations) {
        console.log(`\n--- Testing Variation: ${v.name} ---`);
        try {
            // Raw axios call to bypass service structure
            const response = await axios.post(
                `https://api.aimfox.com/api/v2/campaigns/${campaignId}/audience/multiple`,
                v.payload,
                { headers: { 'Authorization': `Bearer ${process.env.AIMFOX_API_KEY}` } }
            );
            console.log('Success:', JSON.stringify(response.data, null, 2));
            if (response.data.failed?.length === 0) {
                console.log(">>> WORKED! <<<");
                break;
            }
        } catch (error) {
            console.error('Failed:', error.response ? error.response.data : error.message);
        }
    }
};

testPushSimple();
