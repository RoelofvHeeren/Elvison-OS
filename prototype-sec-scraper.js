
import axios from 'axios';
import * as cheerio from 'cheerio';

// SEC requires a descriptive User-Agent
const SEC_HEADERS = {
    'User-Agent': 'ElvisonAI Investor Scraping Prototype (roelof@elvison.ai)',
    'Accept-Encoding': 'gzip, deflate',
    'Host': 'www.sec.gov'
};

async function fetchLatestFormD() {
    try {
        console.log('🔍 Fetching latest Form D filings from SEC EDGAR...');
        const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&count=40&output=atom';
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
        console.error('Error fetching feed:', e.message);
        return [];
    }
}

async function getFilingDetails(entry) {
    try {
        const title = entry.title;
        const link = entry.link;
        const match = link.match(/data\/(\d+)\/(\d+)\//);
        if (!match) return null;

        const cik = match[1];
        const accNo = match[2];
        const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}/primary_doc.xml`;

        // console.log(`\n📄 Checking Filing: ${title}`);
        const res = await axios.get(xmlUrl, { headers: SEC_HEADERS });
        const $ = cheerio.load(res.data, { xmlMode: true });

        // Filter for Real Estate Industry
        const industry = $('industryGroup industryGroupType').text();

        if (industry !== 'Real Estate' && industry !== 'Other Real Estate') {
            // process.stdout.write('.');
            return null;
        }

        const companyName = $('primaryIssuer entityName').text();
        const offeringAmount = $('offeringSalesAmounts totalOfferingAmount').text();

        const relatedPersons = [];
        $('relatedPersonInfo').each((i, el) => {
            const firstName = $(el).find('relatedPersonName firstName').text();
            const lastName = $(el).find('relatedPersonName lastName').text();
            const relationship = $(el).find('relatedPersonRelationshipList relationship').text();
            const city = $(el).find('relatedPersonAddress city').text();
            const state = $(el).find('relatedPersonAddress stateOrCountryDescription').text();

            relatedPersons.push({
                name: `${firstName} ${lastName}`.trim(),
                title: relationship,
                location: `${city}, ${state}`
            });
        });

        return {
            companyName,
            cik,
            industry,
            offeringAmount,
            relatedPersons
        };
    } catch (e) {
        return null;
    }
}

async function runPrototype() {
    const entries = await fetchLatestFormD();
    console.log(`Found ${entries.length} recent filings. Scanning for Real Estate...`);

    const results = [];
    for (const entry of entries) {
        const details = await getFilingDetails(entry);
        if (details) {
            results.push(details);
        }
        await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n\n--- 🎯 HIGH-SIGNAL INVESTOR LEADS ---');
    results.forEach(res => {
        console.log(`\n🏢 Fund: ${res.companyName} (CIK: ${res.cik})`);
        console.log(`💰 Target Offering: $${res.offeringAmount}`);
        console.log('👤 Related Persons (Potential High-Net-Worth Leads):');
        res.relatedPersons.forEach(p => {
            console.log(`   - ${p.name} (${p.title}) in ${p.location}`);
        });
    });

    if (results.length === 0) {
        console.log('\nNo Real Estate filings found in the last batch. Try increasing the count.');
    }
}

runPrototype();
