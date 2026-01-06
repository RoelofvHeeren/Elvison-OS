import dotenv from 'dotenv';
dotenv.config();
import { LeadScraperService } from './src/backend/services/lead-scraper-service.js';

async function main() {
    const scraper = new LeadScraperService();
    const company = { company_name: 'Fengate Asset Management', domain: 'fengate.com' };
    const filters = {
        job_titles: ["CEO", "Founder", "VP", "Director"],
        seniority: ["Director", "Executive"],
        maxResults: 5
    };

    try {
        const { leads } = await scraper.fetchLeads([company], filters);
        console.log(`Found ${leads.length} leads for Fengate.`);
        console.log(JSON.stringify(leads.map(l => l.email), null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
main();
