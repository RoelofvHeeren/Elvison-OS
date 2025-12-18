
import { webSearchTool } from "@openai/agents";

const tool = webSearchTool();
console.log("Keys:", Object.keys(tool));
console.log("Full Object:", JSON.stringify(tool, null, 2));

// Check if there is an execute function
if (tool.execute) console.log("Has .execute()");
else console.log("No .execute()");
