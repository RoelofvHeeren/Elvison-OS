
import { buildPipelineLabsPayload } from './src/backend/services/apify.js';
import assert from 'assert';

console.log("Running Test Suite for Pipeline Labs Payload...");

// Test Case 1: Standard Input
console.log("Test Case 1: Standard Input");
const companyNames = ["Square Capital", "Brookfield"];
const filters = {
    job_titles: ["CEO/President/Owner", "Director Of Operations"],
    seniority_input: "Director and VP level",
};

const payload = buildPipelineLabsPayload(companyNames, filters);

try {
    assert.strictEqual(payload.totalResults, 100);
    assert.deepStrictEqual(payload.personTitleIncludes, ["CEO/President/Owner", "Director Of Operations"]);
    assert.ok(payload.seniorityIncludes.includes("Director"));
    assert.ok(payload.seniorityIncludes.includes("VP"));
    assert.deepStrictEqual(payload.companyNameIncludes, ["Square Capital", "Brookfield"]);
    assert.strictEqual(payload.includeSimilarTitles, true);
    // Ensure NO domain key
    assert.strictEqual(payload.companyDomain, undefined);

    console.log("✅ Test Case 1 Passed!");
} catch (e) {
    console.error("❌ Test Case 1 Failed:", e.message);
    console.error("Payload:", JSON.stringify(payload, null, 2));
    process.exit(1);
}

// Test Case 2: Broad Search (Fetch All)
console.log("Test Case 2: Broad Search (Fetch All)");
const filters2 = { fetchAll: true };
const payload2 = buildPipelineLabsPayload(["Google"], filters2);
try {
    assert.strictEqual(payload2.seniorityIncludes.length, 0); // Should be empty
    assert.strictEqual(payload2.personTitleIncludes.length, 0); // Should be empty
    assert.strictEqual(payload2.personTitleExtraIncludes.length, 0); // Should be empty
    assert.strictEqual(payload2.companyEmployeeSizeIncludes.length, 0); // Should be empty
    assert.deepStrictEqual(payload2.companyNameIncludes, ["Google"]);
    console.log("✅ Test Case 2 Passed!");
} catch (e) {
    console.error("❌ Test Case 2 Failed:", e.message);
    process.exit(1);
}

// Test Case 3: Empty Company List
console.log("Test Case 3: Empty Company List");
const payload3 = buildPipelineLabsPayload([]);
try {
    assert.strictEqual(payload3.companyNameIncludes.length, 0);
    console.log("✅ Test Case 3 Passed!");
} catch (e) {
    console.error("❌ Test Case 3 Failed:", e.message);
    process.exit(1);
}

console.log("Test Case 4: Strict Title Validation");
const filters4 = {
    job_titles: ["CEO/President/Owner", "Invalid Title", "Space  Cadet"],
    seniority_input: "Manager and Intern"
};
const payload4 = buildPipelineLabsPayload(["TestCo"], filters4);
try {
    // Should keep "CEO/President/Owner" (if allowed) or "CEO" depending on list
    // In our allowed list: "CEO/President/Owner" IS allowed. "Invalid Title" is NOT.
    assert.deepStrictEqual(payload4.personTitleIncludes, ["CEO/President/Owner"]);

    // Seniority: "Manager" -> "Head" (allowed), "Intern" -> excluded/ignored for inclusion?
    // "Intern" is NOT in ALLOWED_SENIORITY. "Head" IS.
    // Logic: manager -> Head. 
    assert.ok(payload4.seniorityIncludes.includes("Head"));
    assert.ok(!payload4.seniorityIncludes.includes("Intern"));

    console.log("✅ Test Case 4 Passed!");
} catch (e) {
    console.error("❌ Test Case 4 Failed:", e.message);
    console.error("Payload:", JSON.stringify(payload4, null, 2));
    process.exit(1);
}

console.log("🎉 All Tests Passed!");
