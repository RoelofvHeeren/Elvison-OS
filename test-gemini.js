import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    console.log(`Testing with key: ${apiKey ? apiKey.substring(0, 7) + '...' : 'MISSING'}`);

    if (!apiKey) {
        console.error("❌ No API Key found in environment!");
        return;
    }

    try {
        const google = createGoogleGenerativeAI({ apiKey });
        const model = google('gemini-1.5-flash');

        console.log("🚀 Sending test request to Gemini...");
        const { text } = await generateText({
            model,
            prompt: 'Say "Gemini is online!" if you can hear me.',
        });

        console.log(`✅ Success! Response: ${text}`);
    } catch (error) {
        console.error("❌ Gemini Test Failed!");
        console.error("Error Message:", error.message);
        if (error.data) console.error("Error Data:", JSON.stringify(error.data, null, 2));
    }
}

test();
