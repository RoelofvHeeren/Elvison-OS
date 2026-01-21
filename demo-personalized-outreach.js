
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function generatePersonalizedMessage(leadData) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = `
    You are an elite real estate investment strategist. You are reaching out to a High-Net-Worth individual who was recently identified in an SEC Form D filing for a real estate offering.
    
    LEAD DATA:
    Name: ${leadData.name}
    Role: ${leadData.role}
    Fund: ${leadData.fund}
    Offering Amount: ${leadData.offeringAmount}
    Location: ${leadData.location}
    
    GOAL:
    Start a conversation about a new B2C retail real estate project. 
    The tone must be:
    - Peer-to-peer (you are an insider, not a salesperson)
    - Authority-driven (you know the market)
    - Low-friction (not asking for an investment right now)
    
    INSTRUCTIONS:
    1. Reference the specific SEC filing/fund mentioned in the lead data to build immediate trust.
    2. Suggest a "peer-review" or "market-intelligence sharing" session rather than a "pitch."
    3. Keep it under 100 words.
    
    MESSAGE:
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

async function runDemo() {
    const lead = {
        name: "Clifton Minsley",
        role: "Executive Officer",
        fund: "10FSSAC5-A, LLC",
        offeringAmount: "$150,000,000",
        location: "Raleigh, NC"
    };

    console.log(`🚀 Generating personalized message for ${lead.name}...`);
    const message = await generatePersonalizedMessage(lead);

    console.log('\n--- ✉️ OUTREACH MESSAGE ---');
    console.log(message);
    console.log('--------------------------');
}

runDemo();
