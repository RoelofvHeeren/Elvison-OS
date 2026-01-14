import { query } from './db/index.js';

const updateEitanLead = async () => {
    try {
        const leadId = '280e8308-a83e-46ef-bc48-a215921d3fe1'; // ID from previous step

        console.log('Updating Eitan Franco lead...');

        const connectionRequest = "Hi Eitan, saw RivoAds specializes in lead gen for garage door companies. Impressive that you guarantee ranking Google Business profiles in 30 days. Would love to connect.";

        const emailMessage = `Hi Eitan,

I've been following RivoAds and noticed your focus on generating consistent leads for garage door companies. Your 30-day Google Business ranking guarantee is a bold promise that clearly separates you from the "fake promises" crowd.

I'm working on Elvison OS to help performance-focused agencies like yours scale operations. Would love to swap insights on the home service niche.`;

        const companyProfile = "RivoAds specializes in local lead gen for home services (garage doors, locksmiths), offering SEO, PPC, and a 30-day Google Business ranking guarantee.";

        // Update company name, email, and custom data
        const updateQuery = `
            UPDATE leads 
            SET 
                company_name = 'RivoAds',
                email = 'eitanf@rivoads.com',
                custom_data = jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            jsonb_set(custom_data, '{connection_request}', $1::jsonb),
                            '{email_message}', $2::jsonb
                        ),
                        '{company_profile}', $3::jsonb
                    ),
                    '{company_website}', '"https://rivoads.com"'::jsonb
                )
            WHERE id = $4
        `;

        await query(updateQuery, [
            JSON.stringify(connectionRequest),
            JSON.stringify(emailMessage),
            JSON.stringify(companyProfile),
            leadId
        ]);

        console.log(`✅ Eitan Franco lead updated with RivoAds details and custom messages.`);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
};

updateEitanLead();
