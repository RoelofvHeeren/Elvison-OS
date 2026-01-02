import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Extract JSON from text - strips markdown fences
 */
function extractJson(text) {
    if (!text) return text;

    return text
        .replace(/```json/g, "")
        .replace(/```tool_call/g, "")
        .replace(/```/g, "")
        .trim();
}

/**
 * Hard fail-fast validator for JSON responses
 */
function assertJsonResponse(text, context) {
    try {
        JSON.parse(extractJson(text));
    } catch (e) {
        throw new Error(`Model returned non-JSON output in ${context}:\n${text?.substring(0, 200)}`);
    }
}

/**
 * Convert a Zod schema or raw object to a proper JSON Schema for Gemini
 * Gemini requires: { type: 'object', properties: {...}, required: [...] }
 */
function convertToJsonSchema(params, toolName) {
    // If it's a Zod schema (has _def property), use zodToJsonSchema
    if (params && params._def) {
        try {
            const jsonSchema = zodToJsonSchema(params, {
                $refStrategy: 'none', // Flatten, no $refs
                target: 'jsonSchema7'
            });

            // Remove $schema property as Gemini doesn't like it
            delete jsonSchema.$schema;
            delete jsonSchema.additionalProperties;

            // Ensure type is 'object' at root level
            if (!jsonSchema.type) {
                jsonSchema.type = 'object';
            }

            console.log(`[GeminiModel] Converted Zod schema for ${toolName}:`, JSON.stringify(jsonSchema));
            return jsonSchema;
        } catch (e) {
            console.error(`[GeminiModel] zodToJsonSchema failed for ${toolName}:`, e);
            // Fallback to a minimal object schema
            return { type: 'object', properties: {}, required: [] };
        }
    }

    // If it's already a JSON Schema object
    if (params && typeof params === 'object') {
        const schema = { ...params };

        // Remove problematic properties
        delete schema.$schema;
        delete schema.additionalProperties;

        // Ensure type is 'object'
        if (!schema.type) {
            schema.type = 'object';
        }

        // Ensure properties exists
        if (!schema.properties) {
            schema.properties = {};
        }

        // Ensure required is an array
        if (!Array.isArray(schema.required)) {
            schema.required = [];
        }

        return schema;
    }

    // Fallback
    return { type: 'object', properties: {}, required: [] };
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

        // Build messages array with JSON enforcement as FIRST instruction
        const messages = [];

        // JSON enforcement - zero tolerance
        messages.push({
            role: 'system',
            content: 'You must respond with ONLY valid JSON. Do not include explanations, markdown, code blocks, or any text before or after the JSON.'
        });

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

        // Convert tools to Vercel AI SDK format using zodToJsonSchema
        const vercelTools = {};
        if (tools && tools.length > 0) {
            tools.forEach(t => {
                if (t.type === 'function') {
                    const jsonSchema = convertToJsonSchema(t.parameters, t.name);

                    vercelTools[t.name] = {
                        description: t.description || `Tool: ${t.name}`,
                        parameters: jsonSchema
                    };
                }
            });
        }

        // Debug Log for Tool Structure
        if (tools && tools.length > 0) {
            console.log(`[GeminiModel] Final Tool Structure for ${this.modelName}:`, JSON.stringify(vercelTools, null, 2));
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            const generateOptions = {
                model: modelInstance,
                messages: messages,
            };

            // Pass tools if any
            if (Object.keys(vercelTools).length > 0) {
                generateOptions.tools = vercelTools;
                generateOptions.toolChoice = 'auto';
            }

            const result = await generateText(generateOptions);

            const output = [];

            if (result.text) {
                // Strip markdown before adding to output
                const cleanText = extractJson(result.text);

                output.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: cleanText }],
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
                    promptTokens: result.usage?.promptTokens || 0,
                    completionTokens: result.usage?.completionTokens || 0,
                    totalTokens: result.usage?.totalTokens || 0
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

// Export utilities for use in workflow
export { extractJson, assertJsonResponse };
