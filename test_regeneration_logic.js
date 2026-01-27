import ResearchFactExtractor from './src/backend/services/outreach/researchFactExtractor.js';
import { OutreachService } from './src/backend/services/outreach-service.js';

// Mock DB Lead
const mockLead = {
    company_name: "Alpine Capital",
    company_profile: "Alpine Capital is a real estate private equity firm. We acquired the 300-unit Highland Towers in Austin last year. Our focus is on value-add multifamily assets in the Sunbelt.",
    person_name: "Jane Doe",
    icp_type: "Investment Fund",
    website: "alpinecap.com"
};

async function testLogic() {
    console.log("🧪 Testing Regeneration Logic & Enhancements...\n");

    // 1. Test Research Fact Extraction (New Priorities)
    console.log("--- 1. Testing Fact Extraction ---");
    const facts = ResearchFactExtractor.extract(mockLead.company_profile, mockLead.company_name, mockLead.icp_type);
    console.log(`Fact Type: ${facts.fact_type}`);
    console.log(`Fact: ${facts.fact}`);

    // Expect DEAL because "Highland Towers" (capitalized + unit count context helps)
    // Actually, "Highland Towers" matches the pattern in _extractNamedDeal?
    // Let's see if regex catches "Highland Towers"
    if (facts.fact_type === 'DEAL') {
        console.log("✅ Priority 1 (DEAL) correctly identified.");
    } else if (facts.fact_type === 'SCALE') {
        console.log("⚠️ Priority 2 (SCALE) identified (Acceptable fallback).");
    } else {
        console.log("❌ Failed to identify DEAL or SCALE.");
    }

    // 2. Test Message Generation with New Hooks
    console.log("\n--- 2. Testing Message Templates ---");
    const outlines = await OutreachService.createLeadMessages(mockLead);

    if (outlines.outreach_status === 'SUCCESS') {
        console.log("LinkedIn Message:");
        console.log(outlines.linkedin_message);

        if (outlines.linkedin_message.includes('LP or co-GP capital') || outlines.linkedin_message.includes('co-GP opportunities')) {
            console.log("✅ Micro-hook inserted correctly.");
        } else {
            console.log("❌ Micro-hook MISSING.");
        }
    } else {
        console.log(`❌ Message generation failed: ${outlines.outreach_reason}`);
    }

    // 3. Test Circuit Breaker Metrics (Simulated)
    console.log("\n--- 3. Testing Circuit Breaker API ---");
    // We can't easily import the instance from regeneration script without exporting it, 
    // but we can check if the class is logically sound by creating one.
    const { CircuitBreaker } = await import('./src/utils/circuit-breaker.js');
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 100 });

    try {
        await breaker.execute(async () => { throw new Error("Fail 1"); });
    } catch (e) { }
    try {
        await breaker.execute(async () => { throw new Error("Fail 2"); });
    } catch (e) { }

    // Should be open now
    const state = breaker.getState();
    console.log(`Breaker State after 2 fails: ${state.state}`);
    if (state.state === 'OPEN') {
        console.log("✅ Circuit Breaker opened correctly.");
    } else {
        console.log("❌ Circuit Breaker failed to open.");
    }
}

testLogic();
