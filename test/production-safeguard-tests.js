/**
 * Production Safeguard Tests
 * 
 * Validates that messages containing error keywords are blocked
 * from being sent to GoHighLevel and Aimfox
 */

import { ghlService } from '../src/backend/services/gohighlevel.js';
import { aimfoxService } from '../src/backend/services/aimfox.js';

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
    TESTS.push({ name, fn });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

// ============================================================================
// GOHIGHLEVEL SAFEGUARD TESTS
// ============================================================================

test('GHL: Blocks message containing "skip"', () => {
    const result = ghlService._messagePassesSanityCheck('Hi John, I wanted to skip this one');
    assert(result === false, 'Should block message with "skip"');
});

test('GHL: Blocks message containing "NEEDS_RESEARCH"', () => {
    const result = ghlService._messagePassesSanityCheck('This lead NEEDS_RESEARCH before sending');
    assert(result === false, 'Should block message with "NEEDS_RESEARCH"');
});

test('GHL: Blocks message containing "error"', () => {
    const result = ghlService._messagePassesSanityCheck('There was an error generating this message');
    assert(result === false, 'Should block message with "error"');
});

test('GHL: Blocks message containing "null"', () => {
    const result = ghlService._messagePassesSanityCheck('The value is null');
    assert(result === false, 'Should block message with "null"');
});

test('GHL: Allows valid message', () => {
    const result = ghlService._messagePassesSanityCheck('Hi John, I came across your work at ABC Corp. We develop similar projects at Fifth Avenue Properties. Thought connecting could be worthwhile.');
    assert(result === true, 'Should allow valid message');
});

test('GHL: Allows empty message', () => {
    const result = ghlService._messagePassesSanityCheck('');
    assert(result === true, 'Should allow empty message');
});

// ============================================================================
// AIMFOX SAFEGUARD TESTS
// ============================================================================

test('Aimfox: Blocks message containing "skip"', () => {
    const result = aimfoxService._messagePassesSanityCheck('Hi John, I wanted to skip this one');
    assert(result === false, 'Should block message with "skip"');
});

test('Aimfox: Blocks message containing "needs research"', () => {
    const result = aimfoxService._messagePassesSanityCheck('This lead needs research before sending');
    assert(result === false, 'Should block message with "needs research"');
});

test('Aimfox: Blocks message containing "ERROR"', () => {
    const result = aimfoxService._messagePassesSanityCheck('ERROR: Failed to generate message');
    assert(result === false, 'Should block message with "ERROR"');
});

test('Aimfox: Blocks message containing "undefined"', () => {
    const result = aimfoxService._messagePassesSanityCheck('The value is undefined');
    assert(result === false, 'Should block message with "undefined"');
});

test('Aimfox: Allows valid message', () => {
    const result = aimfoxService._messagePassesSanityCheck('Hi Sarah, I noticed your focus on multifamily residential. We work on similar strategies at Fifth Avenue Properties. Worth connecting if there\'s overlap.');
    assert(result === true, 'Should allow valid message');
});

test('Aimfox: Allows empty message', () => {
    const result = aimfoxService._messagePassesSanityCheck('');
    assert(result === true, 'Should allow empty message');
});

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('PRODUCTION SAFEGUARD TESTS');
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
        console.log('✅ All safeguard tests passed!');
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
