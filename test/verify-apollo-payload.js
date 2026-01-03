
import { buildApolloDomainPayload } from '../src/backend/services/apify.js';
import { strict as assert } from 'node:assert';

console.log("Testing Apollo Payload Construction...");

// Test Case 1: Strict Mode (Domains provided)
{
    console.log("\n--- Test Case 1: Strict Mode ---");
    const domains = ["  example.com  ", "https://google.com"];
    const filters = {
        countries: ["Canada"],
        maxLeads: 5,
        job_titles: ["CEO"]
    };

    const payload = buildApolloDomainPayload(domains, filters);
    console.log("Generated Payload Keys:", Object.keys(payload));

    // Assertions
    assert.ok(!payload.companyCountry, "FAIL: companyCountry should be omitted in strict mode");
    assert.ok(!payload.companyEmployeeSize, "FAIL: companyEmployeeSize should be omitted in strict mode");

    // Domain Validations
    assert.deepEqual(payload.companyDomains, ["example.com", "google.com"], "FAIL: companyDomains should be cleaned");
    assert.deepEqual(payload.organizationDomains, ["example.com", "google.com"], "FAIL: organizationDomains should match");
    assert.equal(payload.qOrganizationDomains, "example.com\ngoogle.com", "FAIL: qOrganizationDomains should be newline separated");

    assert.deepEqual(payload.personTitle, ["CEO"], "FAIL: Titles should be preserved");

    console.log("✅ PASS: Strict mode correctly omitted broad filters and included correct domain params.");
}

// Test Case 2: Broad Mode (Empty domains - technically not allowed by wrapper but good to test fallback)
{
    console.log("\n--- Test Case 2: Broad Mode (Empty Domains) ---");
    const domains = [];
    const filters = {
        countries: ["UK"],
        maxLeads: 5
    };

    const payload = buildApolloDomainPayload(domains, filters);

    // Assertions
    assert.ok(payload.companyCountry, "FAIL: companyCountry should be present for empty domains");
    assert.deepEqual(payload.companyCountry, ["UK"], "FAIL: usage of filters.countries");

    console.log("✅ PASS: Broad mode preserved country filter.");
}
