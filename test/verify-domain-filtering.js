
import { strict as assert } from 'node:assert';

// Mock specific logic from LeadScraperService
function checkDomainMatch(requestedDomainsArray, resultDomain) {
    const requestedDomains = new Set(requestedDomainsArray.map(d => d.toLowerCase().trim()));

    // Normalize result domain
    const leadDomain = (resultDomain || "")
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .toLowerCase()
        .trim();

    const isMatch = requestedDomains.has(leadDomain);

    // Proposed Subdomain Logic (enabled)
    const isSubdomainMatch = !isMatch && [...requestedDomains].some(req => leadDomain.endsWith('.' + req));

    return { isMatch: isMatch || isSubdomainMatch, leadDomain };
}

async function runTest() {
    console.log("Running Domain Mismatch Reproduction...");

    const requested = ["trezcapital.com", "google.com"];

    // Case 1: Exact Match
    const res1 = checkDomainMatch(requested, "https://www.trezcapital.com");
    console.log(`Case 1 (Exact): ${res1.isMatch} (Expected: true)`);
    assert.strictEqual(res1.isMatch, true);

    // Case 2: Mismatch (donairdude.com)
    const res2 = checkDomainMatch(requested, "donairdude.com");
    console.log(`Case 2 (Total Mismatch): ${res2.isMatch} (Expected: false)`);
    assert.strictEqual(res2.isMatch, false);

    // Case 3: Subdomain (corp.google.com) - CURRENTLY FAILS
    const res3 = checkDomainMatch(requested, "corp.google.com");
    console.log(`Case 3 (Subdomain): ${res3.isMatch} (Expected: true for robust system, false for current)`);

    // Case 4: Suffix validation (should NOT match)
    // e.g. "agoogle.com" should not match "google.com"
    const res4 = checkDomainMatch(requested, "agoogle.com");
    console.log(`Case 4 (Suffix Trap): ${res4.isMatch} (Expected: false)`);
    assert.strictEqual(res4.isMatch, false);

    console.log("\nIf Case 3 returns false, we confirmed the strict set lookup rejects subdomains.");
}

runTest().catch(e => console.error(e));
