
import axios from 'axios';
import * as cheerio from 'cheerio';
import { query } from '../../../db/index.js';

const SEC_HEADERS = {
    'User-Agent': 'ElvisonAI Investor Scraper (roelof@elvison.ai)',
    'Accept-Encoding': 'gzip, deflate',
    'Host': 'www.sec.gov'
};

export class SecScraperService {
    constructor() { }

    /**
     * Fetch latest Form D filings from SEC EDGAR
     * @param {number} count 
     * @returns {Promise<Array>}
     */
    async fetchLatestFilings(count = 40) {
        try {
            console.log('🔍 [SEC] Fetching latest Form D filings...');
            const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&count=${count}&output=atom`;
            const response = await axios.get(url, { headers: SEC_HEADERS });

            const $ = cheerio.load(response.data, { xmlMode: true });
            const entries = [];

            $('entry').each((i, el) => {
                entries.push({
                    title: $(el).find('title').text(),
                    link: $(el).find('link').attr('href'),
                    summary: $(el).find('summary').text()
                });
            });

            return entries;
        } catch (e) {
            console.error('[SEC] Error fetching feed:', e.message);
            return [];
        }
    }

    /**
     * process a filing to see if it's Real Estate and extract leads
     * @param {Object} entry 
     * @returns {Promise<Object|null>}
     */
    async processFiling(entry) {
        try {
            const link = entry.link;
            const match = link.match(/data\/(\d+)\/(\d+)\//);
            if (!match) return null; // Should not happen for standard links

            const cik = match[1];
            const accNo = match[2];
            const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}/primary_doc.xml`;

            const res = await axios.get(xmlUrl, { headers: SEC_HEADERS });
            const $ = cheerio.load(res.data, { xmlMode: true });

            // Filter for Real Estate Industry
            const industry = $('industryGroup industryGroupType').text();

            if (industry !== 'Real Estate' && industry !== 'Other Real Estate') {
                return null;
            }

            const companyName = $('primaryIssuer entityName').text();
            const offeringAmount = $('offeringSalesAmounts totalOfferingAmount').text();
            const filingDate = $('signatureDate').text() || new Date().toISOString().split('T')[0];

            // 1. Save Fund
            const fundResult = await query(
                `INSERT INTO funds (company_name, cik, offering_amount, industry, filing_date, sec_url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [companyName, cik, offeringAmount, industry, filingDate, link]
            );
            const fundId = fundResult.rows[0]?.id;

            const leads = [];

            // 2. Extract People
            const relatedPersons = $('relatedPersonInfo');
            for (let i = 0; i < relatedPersons.length; i++) {
                const el = relatedPersons[i];
                const firstName = $(el).find('relatedPersonName firstName').text();
                const lastName = $(el).find('relatedPersonName lastName').text();
                const fullName = `${firstName} ${lastName}`.trim();
                const relationship = $(el).find('relatedPersonRelationshipList relationship').text();
                const city = $(el).find('relatedPersonAddress city').text();
                const state = $(el).find('relatedPersonAddress stateOrCountryDescription').text();
                const location = `${city}, ${state}`;

                // Upsert Lead
                // We initially save basic info; enrichment comes later
                const leadRes = await query(
                    `INSERT INTO leads (person_name, job_title, status, source, fund_id, custom_data)
                     VALUES ($1, $2, 'NEW', 'SEC_FILING', $3, $4)
                     RETURNING id`,
                    [
                        fullName,
                        relationship,
                        fundId,
                        JSON.stringify({ location, sec_role: relationship, form_d_url: link })
                    ]
                );

                leads.push({
                    id: leadRes.rows[0].id,
                    name: fullName,
                    title: relationship,
                    location
                });
            }

            return {
                fundId,
                companyName,
                leads
            };
        } catch (e) {
            console.error(`[SEC] Error processing filing ${entry.title}:`, e.message);
            return null;
        }
    }

    /**
     * Main orchestration method
     */
    async runCycle() {
        const entries = await this.fetchLatestFilings(50);
        console.log(`[SEC] Found ${entries.length} recent filings.`);

        const results = [];
        for (const entry of entries) {
            // Check if we already processed this SEC URL to avoid dupes?
            // For now, naive processing. Ideally we check db first.

            const details = await this.processFiling(entry);
            if (details) {
                results.push(details);
                console.log(`[SEC] ✅ Saved Fund: ${details.companyName} with ${details.leads.length} leads.`);
            }
            await new Promise(r => setTimeout(r, 200)); // Rate limit
        }

        return results;
    }
}

export const secScraperService = new SecScraperService();
