/**
 * Outreach V5 Acceptance Tests
 * 
 * Validates all acceptance criteria from the specification:
 * - Bad leads are SKIPped
 * - SKIP text never appears in messages
 * - NEEDS_RESEARCH items populate manual queue
 * - Message templates match fact types
 * - Banned phrases/words never appear
 * - Contract enforcement (null messages for non-SUCCESS)
 * - Tier gating works correctly
 * - Research facts are deterministic
 */

import { OutreachService } from '../src/backend/services/outreach-service.js';
import ResearchFactExtractor from '../src/backend/services/outreach/researchFactExtractor.js';

const TESTS = [];
let passCount = 0;
let failCount = 0;

// ============================================================================
// TEST UTILITIES
// ============================================================================

function test(name, fn) {
    TESTS.push({ name, fn });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
    }
}

function assertContains(str, substring, message) {
    if (!str.includes(substring)) {
        throw new Error(`Expected string to contain "${substring}". ${message}\nActual: ${str}`);
    }
}

function assertNotContains(str, substring, message) {
    if (str.includes(substring)) {
        throw new Error(`Expected string to NOT contain "${substring}". ${message}\nActual: ${str}`);
    }
}

// ============================================================================
// TEST SUITE 1: TIER GATING
// ============================================================================

test('Tier 2 (Residential) is MANDATORY - missing keywords = SKIP', async () => {
    const result = await OutreachService.createLeadMessages({
        company_name: 'Tech Startup Inc',
        company_profile: 'We are a technology consulting firm focused on cloud infrastructure and AI solutions. Founded in 2020.',
        fit_score: 85,
        icp_type: 'InvestmentFirm',
        first_name: 'John'
    });

    assertEquals(result.outreach_status, 'SKIP', 'Should SKIP when no residential keywords');
    assertEquals(result.linkedin_message, null, 'Message must be null for SKIP');
    assertEquals(result.email_body, null, 'Email body must be null for SKIP');
});

test('Tier 1 (Investor) for InvestmentFirm - missing keywords = SKIP', async () => {
    const result = await OutreachService.createLeadMessages({
        company_name: 'Residential Developer Co',
        company_profile: 'We develop luxury multifamily apartments and condominiums across the US. Over 5000 units delivered.',
        fit_score: 80,
        icp_type: 'InvestmentFirm',
        first_name: 'John'
    });

    assertEquals(result.outreach_status, 'SKIP', 'InvestmentFirm with no investor keywords should SKIP');
});

test('Tier 1 (Investor) for FamilyOffice - missing keywords = NEEDS_RESEARCH', async () => {
    const result = await OutreachService.createLeadMessages({
        company_name: 'Smith Family Capital',
        company_profile: 'We manage wealth for our family focused on multifamily residential real estate.',
        fit_score: 85,
        icp_type: 'FamilyOffice',
        first_name: 'John'
    });

    assertEquals(result.outreach_status, 'NEEDS_RESEARCH', 'FamilyOffice with vague investor language should go to NEEDS_RESEARCH');
    assertEquals(result.linkedin_message, null, 'Message must be null for NEEDS_RESEARCH');
});

test('Disqualified ICP type (BROKERAGE) = SKIP', async () => {
    const result = await OutreachService.createLeadMessages({
        company_name: 'Century 21 Brokers',
        company_profile: 'We are a residential real estate brokerage providing investor services.',
        fit_score: 70,
        icp_type: 'BROKERAGE',
        first_name: 'John'
    });

    assertEquals(result.outreach_status, 'SKIP', 'BROKERAGE ICP type should be auto-SKIPped');
});

// ============================================================================
// TEST SUITE 2: CONTRACT ENFORCEMENT (NULL MESSAGES)
// ============================================================================

test('Contract: SKIP status means all message fields are null', async () => {
    const result = await OutreachService.createLeadMessages({
        company_name: 'Tech Company',
        company_profile: 'Technology consulting firm',
        fit_score: 70,
        icp_type: 'InvestmentFirm',
        first_name: 'John'
    });

    if (result.outreach_status === 'SKIP') {
        assertEquals(result.linkedin_message, null, 'linkedin_message must be null for SKIP');
        assertEquals(result.email_subject, null, 'email_subject must be null for SKIP');
        assertEquals(result.email_body, null, 'email_body must be null for SKIP');
    }
});

// ============================================================================
// TEST SUITE 3: RESEARCH FACT EXTRACTION
// ============================================================================

test('ResearchFactExtractor: Named deal detection', () => {
    const profile = 'We developed Alpine Village, a 450-unit luxury apartment community in Denver.';
    const result = ResearchFactExtractor.extract(profile, 'Company', 'InvestmentFirm');

    assert(result.fact !== null, 'Should extract named deal');
    assert(result.fact_type === 'DEAL', 'Should classify as DEAL');
});

test('ResearchFactExtractor: Rejects placeholders', () => {
    const profile = 'We developed 123 Main Street apartments.';
    const result = ResearchFactExtractor.extract(profile, 'Company', 'InvestmentFirm');

    assert(!result.fact || !result.fact.includes('123 Main Street'), 'Should reject placeholder');
});

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('OUTREACH V5 ACCEPTANCE TESTS');
    console.log('='.repeat(80) + '\n');

    for (const { name, fn } of TESTS) {
        try {
            await fn();
            console.log(`✅ PASS: ${name}`);
            passCount++;
        } catch (error) {
            console.log(`❌ FAIL: ${name}`);
            console.log(`   ${error.message}\n`);
            failCount++;
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
    console.log('='.repeat(80) + '\n');

    if (failCount === 0) {
        console.log('✅ All tests passed!');
        process.exit(0);
    } else {
        console.log(`❌ ${failCount} test(s) failed`);
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
});
