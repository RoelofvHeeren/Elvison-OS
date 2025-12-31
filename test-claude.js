import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const modelId = 'claude-3-haiku-20240307';

    console.log(`Testing Claude with key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'MISSING'}`);

    if (!apiKey) {
        console.error("❌ No API Key found!");
        return;
    }

    try {
        const anthropic = createAnthropic({ apiKey });
        const model = anthropic(modelId);

        console.log(`🚀 Sending test request to ${modelId}...`);
        const { text } = await generateText({
            model,
            prompt: 'Say "Claude 3.5 is online!"',
        });

        console.log(`✅ Success! Response: ${text}`);
    } catch (error) {
        console.error(`❌ ${modelId} Test Failed!`);
        console.error("Error Message:", error.message);
        if (error.data) console.error("Error Data:", JSON.stringify(error.data, null, 2));
    }
}

test();
