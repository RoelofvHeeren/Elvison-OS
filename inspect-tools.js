
import { Agent, Runner, hostedMcpTool } from "@openai/agents";
import dotenv from 'dotenv';
dotenv.config();

const apolloMcp = hostedMcpTool({
    serverLabel: "Apollo_MCP",
    allowedTools: [
        "people_search"
    ],
    authorization: "apollo-mcp-client-key-01",
    requireApproval: "never",
    serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01"
});

const inspectorAgent = new Agent({
    name: "Inspector",
    instructions: "You are a tool inspector. Your ONLY goal is to output the JSON schema or list of arguments for the 'people_search' tool that you have access to. Be precise. lists all keys like 'q_organization_domains', 'person_titles', etc.",
    model: "gpt-5-mini",
    tools: [apolloMcp],
});

async function runInspection() {
    console.log("Inspecting people_search tool...");
    const runner = new Runner();
    try {
        const result = await runner.run(inspectorAgent, [
            { role: "user", content: "What arguments does people_search accept? specifically check for domain filtration args." }
        ]);
        console.log("\n--- AGENT OUTPUT ---");
        console.log(result.finalOutput);
    } catch (error) {
        console.error("Inspection failed:", error);
    }
}

runInspection();
