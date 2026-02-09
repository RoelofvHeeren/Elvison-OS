
const originalLeads = [
    { email: 'John.Doe@example.com', first_name: 'John', last_name: 'Doe' },
    { email: 'jane.smith@test.com', first_name: 'Jane', last_name: 'Smith' },
    { email: 'bob.jones@test.com', first_name: 'Bob', last_name: 'Jones' },
    { email: 'alice.wong@test.com', first_name: 'Alice', last_name: 'Wong' }
];

const aiResponse = {
    leads: [
        {
            // Case 1: Both provided (Standard)
            email: 'john.doe@example.com',
            connection_request: 'Connect request for John',
            linkedin_message: 'LinkedIn msg for John (should stay same as conn req)',
            email_subject: 'Hello',
            email_message: 'Email msg for John'
        },
        {
            // Case 2: Only linkedin_message provided (Legacy AI output)
            email: 'jane.smith@test.com',
            linkedin_message: 'LinkedIn msg for Jane',
            // Missing connection_request
            email_subject: 'Hello Jane',
            email_message: 'Email msg for Jane'
        },
        {
            // Case 3: Only email_body provided (Legacy AI output)
            email: 'bob.jones@test.com',
            connection_request: 'Connect request for Bob',
            email_subject: 'Hello Bob',
            email_body: 'Email body for Bob'
            // Missing email_message
        },
        {
            // Case 4: Only connection_request provided (New Standard)
            email: 'alice.wong@test.com',
            connection_request: 'Connect request for Alice',
            email_subject: 'Hello Alice',
            email_message: 'Email msg for Alice'
        }
    ]
};

console.log("--- Executing Standardization Logic ---");

// LOGIC FROM WORKFLOW.JS
const outreachMap = new Map(aiResponse.leads.map(l => [(l.email || '').toLowerCase(), l]));
const finalLeads = [];

originalLeads.forEach(original => {
    let processedLead = { ...original };
    const update = outreachMap.get((original.email || '').toLowerCase());

    if (update) {
        const connReq = update.connection_request || update.linkedin_message || original.connection_request || original.linkedin_message;
        const emailMsg = update.email_message || update.email_body || original.email_message || original.email_body;

        processedLead = {
            ...original,
            // Email Standardization: Use email_message as primary, sync to email_body
            email_message: emailMsg,
            email_body: emailMsg,
            email_subject: update.email_subject || original.email_subject,

            // LinkedIn Standardization: Use connection_request as primary, sync to linkedin_message
            connection_request: connReq,
            linkedin_message: connReq
        };
        console.log(`✅ Processed ${original.email}`);
    } else {
        console.log(`❌ No match found for ${original.email}`);
    }
    finalLeads.push(processedLead);
});

console.log("--- Final Processed Leads ---");
console.log(JSON.stringify(finalLeads, null, 2));

// Verification
let failures = [];

const john = finalLeads.find(l => l.email === 'John.Doe@example.com');
// For John, connection_request should take precedence if both exist, but here I realized my code takes OR.
// Actually, `update.connection_request` comes first in the OR chain, so it wins.
if (john.connection_request !== 'Connect request for John') failures.push("John: Connection request priority failed");
if (john.linkedin_message !== 'Connect request for John') failures.push("John: Sync to linkedin_message failed");

const jane = finalLeads.find(l => l.email === 'jane.smith@test.com');
if (jane.connection_request !== 'LinkedIn msg for Jane') failures.push("Jane: Fallback from linkedin_message failed");
if (jane.linkedin_message !== 'LinkedIn msg for Jane') failures.push("Jane: Sync from fallback failed");

const bob = finalLeads.find(l => l.email === 'bob.jones@test.com');
if (bob.email_message !== 'Email body for Bob') failures.push("Bob: Fallback from email_body failed");
if (bob.email_body !== 'Email body for Bob') failures.push("Bob: Sync from fallback failed");

const alice = finalLeads.find(l => l.email === 'alice.wong@test.com');
if (alice.linkedin_message !== 'Connect request for Alice') failures.push("Alice: Sync to linkedin_message failed");

if (failures.length > 0) {
    console.error("❌ Tests Failed:", failures);
} else {
    console.log("✅ All Standardization Tests Passed");
}
