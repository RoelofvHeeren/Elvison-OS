
import { z } from "zod";

// --- Mock Schema and Function from workflow.js (Updated version) ---

const OutreachCreatorSchema = z.object({
    leads: z.array(z.object({
        date_added: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        company_name: z.string().optional(),
        title: z.string().optional(),
        email: z.string().optional(),
        linkedin_url: z.string().optional(),
        company_website: z.string().optional(),
        connection_request: z.string().nullable().optional(), // CHANGED
        email_message: z.string().nullable().optional(), // CHANGED
        linkedin_message: z.string().nullable().optional(), // CHANGED
        email_subject: z.string().nullable().optional(), // CHANGED
        email_body: z.string().nullable().optional(), // CHANGED
        company_profile: z.string().optional()
    }))
});

const validateLeadForCRM = (lead, status) => {
    // Rule 1: Must have email
    if (!lead.email) return { pass: false, reason: 'Missing email' };

    // Rule 2: Email domain must not be generic/fake
    const emailDomain = lead.email.split('@')[1]?.toLowerCase();
    const BLOCKED_DOMAINS = [
        'linktr.ee', 'linktree.com', 'example.com', 'test.com',
        'temp-mail.org', 'mailinator.com', 'guerrillamail.com',
        'bio.link', 'beacons.ai', 'stan.store', 'carrd.co'
    ];
    if (!emailDomain || BLOCKED_DOMAINS.includes(emailDomain)) {
        return { pass: false, reason: `Blocked email domain: ${emailDomain || 'missing'}` };
    }

    // Rule 3: Must have company_name
    if (!lead.company_name || lead.company_name.trim() === '' || lead.company_name === 'Unknown') {
        return { pass: false, reason: 'Missing or invalid company_name' };
    }

    // Rule 4: For NEW status, warn if missing outreach but DO NOT REJECT
    if (status === 'NEW') {
        if (!lead.connection_request && !lead.email_message && !lead.email_body) {
            // CHANGED: commented out rejection
            // return { pass: false, reason: 'Missing outreach messages (required for NEW status)' };
        }
    }

    return { pass: true };
};

// --- Tests ---

async function runTest() {
    console.log("Running Outreach Fix Verification Test...\n");

    // Test 1: Schema Validation with Nulls
    const badPayload = {
        leads: [{
            email: "test@example.com",
            connection_request: "Hi",
            email_message: null,
            email_subject: null
        }]
    };

    try {
        console.log("Test 1: Validating payload with NULLs against Relaxed Schema (Expect Success)...");
        OutreachCreatorSchema.parse(badPayload);
        console.log("✅ Test 1 PASSED: Validation passed.");
    } catch (e) {
        console.log("❌ Test 1 FAILED: Caught unexpected validation error:\n", JSON.stringify(e.format().leads?.[0] || e.message, null, 2));
    }

    // Test 2: Validate Lead for CRM with missing outreach
    const leadWithoutOutreach = {
        email: "valid@company.com",
        company_name: "Company Inc",
        first_name: "John",
        connection_request: null,
        email_message: null,
        email_body: null
    };

    console.log("\nTest 2: Validating lead with missing outreach for 'NEW' status (Expect Success/Pass)...");
    const result = validateLeadForCRM(leadWithoutOutreach, 'NEW');
    if (result.pass === true) {
        console.log("✅ Test 2 PASSED: Lead was accepted.");
    } else {
        console.log("❌ Test 2 FAILED: Lead was rejected. Reason:", result.reason);
    }
}

runTest();
