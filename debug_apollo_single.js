
import { Agent, Runner, hostedMcpTool } from "@openai/agents";
import { z } from "zod";
import dotenv from 'dotenv';

dotenv.config();

const apolloMcp = hostedMcpTool({
    serverLabel: "Apollo_MCP",
    allowedTools: ["get_person_email", "people_search"],
    authorization: "apollo-mcp-client-key-01",
    requireApproval: "never",
    serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01"
});

const runner = new Runner();

async function debugSingle() {
    const input = {
        linkedin: "https://ca.linkedin.com/in/michaelsarracini",
        name: "Michael Sarracini",
        location: "Toronto, Canada"
    };

    console.log("Testing Apollo with:", input);

    const agent = new Agent({
        name: "Debug Agent",
        instructions: "Find the email for this person. Return the raw result.",
        model: "gpt-4o",
        tools: [apolloMcp]
    });

    const result = await runner.run(agent, [
        { role: "user", content: "Find email for: " + JSON.stringify(input) }
    ]);

    console.log("FINAL OUTPUT:", JSON.stringify(result, null, 2));
}

debugSingle();
