import { Agent } from "@openai/agents";
import { z } from "zod";
import { AGENT_MODELS } from "../config/workflow.js";

// --- Schemas ---

export const OutreachCreatorSchema = z.object({
    leads: z.array(z.object({
        date_added: z.string(),
        first_name: z.string(),
        last_name: z.string(),
        company_name: z.string(),
        title: z.string(),
        email: z.string(),
        linkedin_url: z.string(),
        company_website: z.string(),
        connection_request: z.string(),
        email_message: z.string(),
        company_profile: z.string()
    }))
});

// --- Factory Functions ---

/**
 * Creates an Outreach Creator agent instance.
 * @param {string} instructions - System prompt/instructions.
 * @param {Array} tools - Array of tools (e.g. fileSearchTool).
 * @returns {Agent}
 */
export const createOutreachAgent = (instructions, tools = []) => {
    return new Agent({
        name: "Outreach Creator",
        instructions: instructions || "You are an expert copywriter...",
        model: AGENT_MODELS.outreach_creator || "gpt-4o",
        tools: tools,
        outputType: OutreachCreatorSchema,
    });
};
