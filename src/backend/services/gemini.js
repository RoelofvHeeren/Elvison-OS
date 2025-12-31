import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { z } from 'zod';

/**
 * Hardcoded Gemini tool schemas
 * Gemini requires boring and explicit. No dynamic schemas.
 */
function buildGeminiParametersSchema(toolName) {
    if (toolName === 'google_search_and_extract') {
        return {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Google search query"
                }
            },
            required: ["query"]
        };
    }

    if (toolName === 'scrape_company_website') {
        return {
            type: "object",
            properties: {
                domain: {
                    type: "string",
                    description: "Domain to scrape"
                }
            },
            required: ["domain"]
        };
    }

    // Default fallback
    return {
        type: "object",
        properties: {
            input: {
                type: "string",
                description: "Input value"
            }
        },
        required: ["input"]
    };
}

/**
 * Hard validator - prevents silent future regressions
 */
function assertValidGeminiSchema(schema, toolName) {
    if (!schema || schema.type !== "object") {
        throw new Error(`Gemini schema invalid for ${toolName}: root type must be object`);
    }

    if (typeof schema.properties !== "object") {
        throw new Error(`Gemini schema invalid for ${toolName}: properties missing`);
    }

    if (schema.required && !Array.isArray(schema.required)) {
        throw new Error(`Gemini schema invalid for ${toolName}: required must be array`);
    }
}

/**
 * Convert hardcoded JSON Schema to Zod for Vercel AI SDK
 */
function jsonSchemaToZod(schema) {
    const shape = {};

    for (const [key, prop] of Object.entries(schema.properties || {})) {
        let zodType;
        switch (prop.type) {
            case 'string':
                zodType = z.string();
                break;
            case 'number':
            case 'integer':
                zodType = z.number();
                break;
            case 'boolean':
                zodType = z.boolean();
                break;
            default:
                zodType = z.any();
        }

        if (prop.description) {
            zodType = zodType.describe(prop.description);
        }

        if (!schema.required?.includes(key)) {
            zodType = zodType.optional();
        }

        shape[key] = zodType;
    }

    return z.object(shape);
}

/**
 * GeminiModel Implementation for @openai/agents
 */
export class GeminiModel {
    constructor(apiKey, modelName = 'gemini-2.0-flash') {
        if (!apiKey) throw new Error("Missing API Key for GeminiModel");
        this.modelName = modelName;
        this.apiKey = typeof apiKey === 'string' ? apiKey.trim().replace(/[\s\r\n\t]/g, '') : apiKey;
        this.googleProvider = createGoogleGenerativeAI({ apiKey: this.apiKey });
    }

    async getResponse(request) {
        const { systemInstructions, input, tools, outputType } = request;

        // Build messages array
        const messages = [];
        if (systemInstructions) {
            messages.push({ role: 'system', content: systemInstructions });
        }

        if (Array.isArray(input)) {
            input.forEach(item => {
                if (item.content && Array.isArray(item.content)) {
                    const textContent = item.content.find(c => c.type === 'text' || c.type === 'output_text')?.text || "";
                    if (textContent) {
                        messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: textContent });
                    }
                } else if (item.content && typeof item.content === 'string') {
                    messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content });
                }
            });
        } else if (typeof input === 'string') {
            messages.push({ role: 'user', content: input });
        }

        // Build Gemini-compatible tools using HARDCODED schemas only
        let vercelTools = undefined;
        if (tools && tools.length > 0) {
            vercelTools = {};
            for (const t of tools) {
                if (t.type === 'function') {
                    // Use hardcoded schema - NO dynamic schemas
                    const params = buildGeminiParametersSchema(t.name);

                    // Validate before sending
                    assertValidGeminiSchema(params, t.name);

                    // Log the exact schema being used
                    console.log(`[Gemini Tool] ${t.name}:`, JSON.stringify(params));

                    // Convert to Zod for Vercel AI SDK
                    vercelTools[t.name] = {
                        description: t.description || "No description",
                        parameters: jsonSchemaToZod(params)
                    };
                }
            }
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            const generateOptions = {
                model: modelInstance,
                messages: messages,
            };

            if (vercelTools && Object.keys(vercelTools).length > 0) {
                generateOptions.tools = vercelTools;
                generateOptions.toolChoice = 'auto';
            }

            const result = await generateText(generateOptions);

            const output = [];

            if (result.text) {
                output.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: result.text }],
                    status: 'completed'
                });
            }

            if (result.toolCalls && result.toolCalls.length > 0) {
                result.toolCalls.forEach(tc => {
                    output.push({
                        type: 'tool_call',
                        toolCallId: tc.toolCallId,
                        name: tc.toolName,
                        parameters: tc.args
                    });
                });
            }

            return {
                usage: {
                    promptTokens: result.usage.promptTokens,
                    completionTokens: result.usage.completionTokens,
                    totalTokens: result.usage.totalTokens
                },
                output: output
            };

        } catch (e) {
            console.error("[GeminiModel] Error:", e);
            throw e;
        }
    }

    async *getStreamedResponse(request) {
        const response = await this.getResponse(request);
        yield { type: 'message_start', role: 'assistant' };
        for (const item of response.output) {
            if (item.type === 'message') {
                yield { type: 'message_delta', content: item.content };
            }
        }
        yield { type: 'message_completed', output: response.output };
    }
}
