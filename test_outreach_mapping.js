
const originalLeads = [
    { email: 'John.Doe@example.com', first_name: 'John', last_name: 'Doe' },
    { email: 'jane.smith@test.com', first_name: 'Jane', last_name: 'Smith' },
    { email: 'missing.lead@test.com', first_name: 'Missing', last_name: 'Lead' }
];

const aiResponse = {
    leads: [
        {
            email: 'john.doe@example.com',
            connection_request: 'Connect request for John',
            email_message: 'Email msg for John'
        },
        {
            email: 'jane.smith@test.com',
            // Missing connection_request and email_message
            email_subject: 'Hello Jane'
        }
    ]
};

console.log("--- Executing Reliability & Standardization Logic ---");

const outreachMap = new Map(aiResponse.leads.map(l => [(l.email || '').toLowerCase(), l]));
const finalLeads = [];

originalLeads.forEach(original => {
    let processedLead = { ...original };
    const update = outreachMap.get((original.email || '').toLowerCase());

    if (update && (update.connection_request || update.email_message)) {
        const connReq = update.connection_request || update.linkedin_message || original.connection_request || original.linkedin_message;
        const emailMsg = update.email_message || update.email_body || original.email_message || original.email_body;

        processedLead = {
            ...original,
            email_message: emailMsg,
            email_body: emailMsg,
            email_subject: update.email_subject || original.email_subject,
            connection_request: connReq,
            linkedin_message: connReq,
            status: 'NEW'
        };
        console.log(`✅ Processed ${original.email} - Status: NEW`);
    } else {
        // AI failed or returned empty for this lead
        processedLead.status = 'MANUAL_REVIEW';
        processedLead.disqualification_reason = 'AI Generation Failed - No message returned for this lead';
        console.log(`⚠️ Flagged ${original.email} - Status: MANUAL_REVIEW`);
    }
    finalLeads.push(processedLead);
});

console.log("--- Final Processed Leads ---");
console.log(JSON.stringify(finalLeads, null, 2));

// Verification
let failures = [];

const john = finalLeads.find(l => l.email === 'John.Doe@example.com');
if (john.status !== 'NEW') failures.push("John: Status should be NEW");
if (!john.connection_request) failures.push("John: Connection request missing");

const jane = finalLeads.find(l => l.email === 'jane.smith@test.com');
if (jane.status !== 'MANUAL_REVIEW') failures.push("Jane: Status should be MANUAL_REVIEW (missing messages)");

const missing = finalLeads.find(l => l.email === 'missing.lead@test.com');
if (missing.status !== 'MANUAL_REVIEW') failures.push("Missing: Status should be MANUAL_REVIEW (not in AI response)");

if (failures.length > 0) {
    console.error("❌ Tests Failed:", failures);
    process.exit(1);
} else {
    console.log("✅ All Reliability Tests Passed");
}
