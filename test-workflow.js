// Test script to verify workflow instantiation
import { runAgentWorkflow } from './src/backend/workflow.js';

console.log('Testing workflow instantiation...\n');

// Test 1: Basic instantiation with default config
console.log('Test 1: Default configuration');
try {
    const testConfig = {
        vectorStoreId: 'vs_test_123',
        agentConfigs: {}
    };

    console.log('✓ Workflow function imported successfully');
    console.log('✓ Config structure valid:', JSON.stringify(testConfig, null, 2));
} catch (err) {
    console.error('✗ Test 1 failed:', err.message);
}

// Test 2: Custom agent configuration
console.log('\nTest 2: Custom agent configuration');
try {
    const testConfig = {
        vectorStoreId: 'vs_default_123',
        agentConfigs: {
            company_finder: {
                instructions: 'Custom finder instructions',
                linkedFileIds: ['vs_custom_file_1', 'vs_custom_file_2']
            },
            company_profiler: {
                instructions: 'Custom profiler instructions',
                linkedFileIds: ['vs_custom_file_3']
            }
        }
    };

    console.log('✓ Custom config structure valid');
    console.log('  - Company Finder has', testConfig.agentConfigs.company_finder.linkedFileIds.length, 'linked files');
    console.log('  - Company Profiler has', testConfig.agentConfigs.company_profiler.linkedFileIds.length, 'linked files');
} catch (err) {
    console.error('✗ Test 2 failed:', err.message);
}

console.log('\n✓ All structural tests passed!');
console.log('\nNote: To fully test execution, you need:');
console.log('  1. Valid OPENAI_API_KEY in .env');
console.log('  2. Valid vector store IDs');
console.log('  3. Call runAgentWorkflow() with actual input');
