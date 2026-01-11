import { query } from '../db/index.js';

const createLead = async () => {
    try {
        console.log("Creating test lead: Ben Nathan...");

        // 1. Get User ID (Admin)
        const userRes = await query("SELECT id FROM users LIMIT 1");
        if (userRes.rows.length === 0) {
            console.error("No users found.");
            process.exit(1);
        }
        const userId = userRes.rows[0].id;

        // 2. Lead Data
        const lead = {
            company_name: "Fifth Avenue Properties",
            person_name: "Ben Nathan",
            email: "bnathan@hazenroadbtr.com",
            job_title: "Sales Manager",
            linkedin_url: "https://www.linkedin.com/in/ben-nathan-8209332ba/",
            custom_data: {
                company_website: "fifthaveproperties.com", // Inferring from company name/email domain context
                company_profile: "Fifth Avenue Properties is a real estate investment and development firm focusing on residential strategies. They specialize in build-to-rent (BTR) communities and other opportunistic real estate ventures.",
                connection_request: "",
                email_message: ""
            },
            source: "Manual Creation"
        };

        // 3. Insert
        const res = await query(`
            INSERT INTO leads (user_id, company_name, person_name, email, job_title, linkedin_url, status, custom_data, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, $8)
            RETURNING id;
        `, [
            userId,
            lead.company_name,
            lead.person_name,
            lead.email,
            lead.job_title,
            lead.linkedin_url,
            JSON.stringify(lead.custom_data),
            lead.source
        ]);

        console.log(`✅ created lead with ID: ${res.rows[0].id}`);
        process.exit(0);

    } catch (err) {
        console.error("❌ Failed to create lead:", err);
        process.exit(1);
    }
};

createLead();
