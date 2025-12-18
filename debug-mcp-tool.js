import { hostedMcpTool } from "@openai/agents";

const tool1 = hostedMcpTool({
    serverName: "apollo",
    server_label: "Apollo Lead Finder"
});

console.log("Tool 1 (snake_case):", JSON.stringify(tool1, null, 2));

const tool2 = hostedMcpTool({
    serverName: "apollo",
    serverLabel: "Apollo Lead Finder"
});

console.log("Tool 2 (camelCase):", JSON.stringify(tool2, null, 2));

const tool3 = hostedMcpTool({
    connectorId: "apollo",
    serverLabel: "Apollo Lead Finder"
});

console.log("Tool 3 (connectorId):", JSON.stringify(tool3, null, 2));
