import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';

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
     * Convert a Zod schema or raw object to a proper JSON Schema for Anthropic
     * Anthropic requires: { type: 'object', properties: {...}, required: [...] }
     */
    convertToJsonSchema(params, toolName) {
        // If it's a Zod schema (has _def property), use zodToJsonSchema
        if (params && params._def) {
            try {
                const jsonSchema = zodToJsonSchema(params, {
                    $refStrategy: 'none', // Flatten, no $refs
                    target: 'jsonSchema7'
                });

                // Remove $schema property as Anthropic doesn't like it
                delete jsonSchema.$schema;

                // Ensure type is 'object' at root level
                if (!jsonSchema.type) {
                    jsonSchema.type = 'object';
                }

                console.log(`[ClaudeModel] Converted Zod schema for ${toolName}:`, JSON.stringify(jsonSchema));
                return jsonSchema;
            } catch (e) {
                console.error(`[ClaudeModel] zodToJsonSchema failed for ${toolName}:`, e);
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
        // Vercel AI SDK expects: { toolName: { description, parameters } }
        // where parameters is a JSON Schema object
        const vercelTools = {};
        if (tools && tools.length > 0) {
            tools.forEach(t => {
                if (t.type === 'function') {
                    const jsonSchema = this.convertToJsonSchema(t.parameters, t.name);

                    vercelTools[t.name] = {
                        description: t.description || `Tool: ${t.name}`,
                        parameters: jsonSchema
                    };
                }
            });
        }

        // Debug Log for Tool Structure
        if (tools && tools.length > 0) {
            console.log(`[ClaudeModel] Final Tool Structure for ${this.modelName}:`, JSON.stringify(vercelTools, null, 2));
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
