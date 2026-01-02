
import { z } from "zod";
import { tool } from "@openai/agents";

const myTool = tool({
    name: "scan_site_structure",
    description: "Step 1: Scan homepage/sitemap to discover available pages/links.",
    parameters: z.object({ domain: z.string() }),
    execute: async ({ domain }) => {
        return "mock";
    }
});

console.log("Tool Structure:", JSON.stringify(myTool, null, 2));

// Simulate what ClaudeModel does
const vercelTool = {
    description: myTool.description,
    parameters: myTool.parameters,
};

console.log("Vercel Tool Parameters:", vercelTool.parameters);
console.log("Is Zod Schema?", vercelTool.parameters instanceof z.ZodType);
console.log("Zod Type:", vercelTool.parameters._def.typeName);
