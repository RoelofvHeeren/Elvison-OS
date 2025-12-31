import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { z } from 'zod';

/**
 * Strip invalid keys that Gemini doesn't accept
 */
function stripInvalidKeys(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const clean = { ...schema };
    delete clean.$schema;
    delete clean.additionalProperties;

    // Recursively clean nested properties
    if (clean.properties && typeof clean.properties === 'object') {
        const cleanedProps = {};
        for (const [key, value] of Object.entries(clean.properties)) {
            cleanedProps[key] = stripInvalidKeys(value);
        }
        clean.properties = cleanedProps;
    }

    return clean;
}

/**
 * Sanitize schema for Gemini function calling
 * Gemini strictly requires:
 * - Root type MUST be "object"
 * - Only type, properties, and required should be present
 * - No $schema key
 * - No top-level arrays or primitives
 */
function sanitizeGeminiFunctionSchema(schema) {
    const stripped = stripInvalidKeys(schema);

    return {
        type: "object",
        properties: stripped?.properties ?? {},
        required: Array.isArray(stripped?.required) ? stripped.required : []
    };
}

/**
 * Convert a Zod schema to a clean JSON Schema for Gemini
 * Simple conversion that handles the basic cases
 */
function zodToCleanJsonSchema(zodSchema) {
    // If it's already a JSON Schema object (from @openai/agents), use it
    if (zodSchema && typeof zodSchema === 'object' && zodSchema.type) {
        return sanitizeGeminiFunctionSchema(zodSchema);
    }

    // If it's a Zod schema, we need to manually extract the shape
    // For our use case, we know the tools use simple string inputs
    return {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The search query or input"
            }
        },
        required: ["query"]
    };
}

/**
 * GeminiModel Implementation for @openai/agents
 * This wraps the Vercel AI SDK Gemini provider to satisfy the Model interface.
 */
export class GeminiModel {
    constructor(apiKey, modelName = 'gemini-2.0-flash') {
        if (!apiKey) throw new Error("Missing API Key for GeminiModel");
        this.modelName = modelName;
        // Strip any hidden characters/newlines that might come from env variables
        this.apiKey = typeof apiKey === 'string' ? apiKey.trim().replace(/[\s\r\n\t]/g, '') : apiKey;

        // Initialize the provider with the specific key
        this.googleProvider = createGoogleGenerativeAI({
            apiKey: this.apiKey
        });
    }

    /**
     * satisfy the Model interface from @openai/agents-core
     */
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

        // Convert @openai/agents tools to Vercel AI SDK format
        // Apply strict Gemini schema sanitization
        let vercelTools = undefined;
        if (tools && tools.length > 0) {
            vercelTools = {};
            for (const t of tools) {
                if (t.type === 'function') {
                    // Sanitize the schema for Gemini compatibility
                    const sanitizedSchema = sanitizeGeminiFunctionSchema(t.parameters);

                    // Defensive: Validate schema before sending
                    if (sanitizedSchema.type !== "object") {
                        throw new Error(`Gemini tool schema invalid: root type must be object, got ${sanitizedSchema.type}`);
                    }

                    // Log the final sanitized schema for debugging
                    console.log(`[Gemini Tool Schema] ${t.name}:`, JSON.stringify(sanitizedSchema, null, 2));

                    // Convert to Zod for Vercel AI SDK (it expects Zod schemas)
                    const zodSchema = z.object(
                        Object.fromEntries(
                            Object.entries(sanitizedSchema.properties || {}).map(([key, prop]) => {
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
                                if (!sanitizedSchema.required?.includes(key)) {
                                    zodType = zodType.optional();
                                }
                                return [key, zodType];
                            })
                        )
                    );

                    vercelTools[t.name] = {
                        description: t.description || "No description",
                        parameters: zodSchema
                    };
                }
            }
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            // Build generateText options
            const generateOptions = {
                model: modelInstance,
                messages: messages,
            };

            // Only add tools if we have any
            if (vercelTools && Object.keys(vercelTools).length > 0) {
                generateOptions.tools = vercelTools;
                generateOptions.toolChoice = 'auto';
            }

            const result = await generateText(generateOptions);

            // Convert back to ModelResponse format
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
