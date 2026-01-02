import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

/**
 * ClaudeModel Implementation for @openai/agents
 * This wraps the Vercel AI SDK Anthropic provider to satisfy the Model interface.
 */
export class ClaudeModel {
    constructor(apiKey, modelName = 'claude-3-5-sonnet-20240620') {
        if (!apiKey) throw new Error("Missing API Key for ClaudeModel");
        this.modelName = modelName;
        this.apiKey = apiKey;

        // Initialize the provider with the specific key
        this.anthropicProvider = createAnthropic({
            apiKey: this.apiKey
        });
    }

    /**
     * satisfy the Model interface from @openai/agents-core
     */
    async getResponse(request) {
        const { systemInstructions, input, tools, outputType } = request;

        // Convert input to Vercel AI SDK format (messages)
        const messages = [];
        if (systemInstructions) {
            messages.push({ role: 'system', content: systemInstructions });
        }

        if (Array.isArray(input)) {
            input.forEach(item => {
                if (item.type === 'message') {
                    messages.push({ role: item.role, content: item.content[0].text });
                }
            });
        } else {
            messages.push({ role: 'user', content: input });
        }

        // Convert tools to Vercel AI SDK format
        const vercelTools = {};
        if (tools && tools.length > 0) {
            tools.forEach(t => {
                if (t.type === 'function') {
                    // Sanitize parameters if it's a JSON Schema object
                    let params = t.parameters;

                    // Debug raw params
                    console.log(`[ClaudeModel] Raw params for ${t.name}:`, JSON.stringify(params, null, 2));

                    // MANUAL ZOD CONVERSION (Hack for Anthropic Strictness)
                    // If it looks like a Zod schema (has _def), manually construct JSON Schema
                    if (params && params._def) {
                        try {
                            const def = params._def;
                            if (def.typeName === 'ZodObject') {
                                const properties = {};
                                const required = [];

                                for (const [key, schema] of Object.entries(def.shape())) {
                                    let type = 'string'; // Default
                                    const shapeType = schema._def.typeName;

                                    if (shapeType === 'ZodString') type = 'string';
                                    if (shapeType === 'ZodNumber') type = 'number';
                                    if (shapeType === 'ZodBoolean') type = 'boolean';
                                    if (shapeType === 'ZodArray') type = 'array';

                                    properties[key] = { type };

                                    // Handle Array items
                                    if (type === 'array' && schema._def.type) {
                                        // Simplify: assume string array for urls
                                        properties[key].items = { type: 'string' };
                                    }

                                    if (!schema.isOptional()) {
                                        required.push(key);
                                    }
                                }

                                params = {
                                    type: 'object',
                                    properties,
                                    required
                                };
                                console.log(`[ClaudeModel] Manually converted Zod schema for ${t.name}:`, JSON.stringify(params));
                            }
                        } catch (e) {
                            console.error(`[ClaudeModel] Zod conversion failed for ${t.name}`, e);
                        }
                    } else if (params && typeof params === 'object' && !params.parse) { // Not a Zod schema
                        params = { ...params }; // Clone

                        // SANITIZATION FOR ANTHROPIC
                        delete params.$schema; // Remove $schema
                        delete params.additionalProperties; // Remove additionalProperties (can cause issues)

                        // FIX: Unconditionally set type to object
                        params.type = 'object';
                    }

                    vercelTools[t.name] = {
                        description: t.description,
                        parameters: params,
                    };
                }
            });
        }

        // Debug Log for Tool Structure
        if (tools && tools.length > 0) {
            console.log(`[ClaudeModel] Constructed Tools for ${this.modelName}:`, JSON.stringify(vercelTools, null, 2));
        }

        try {
            const modelInstance = this.anthropicProvider(this.modelName);

            const result = await generateText({
                model: modelInstance,
                messages: messages,
                tools: vercelTools,
                toolChoice: 'auto',
            });

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
            console.error("[ClaudeModel] Error:", e);
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
