import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

/**
 * GeminiModel Implementation for @openai/agents
 * This wraps the Vercel AI SDK Gemini provider to satisfy the Model interface.
 */
export class GeminiModel {
    constructor(apiKey, modelName = 'gemini-1.5-flash') {
        if (!apiKey) throw new Error("Missing GOOGLE_API_KEY for GeminiModel");
        this.google = google;
        this.modelName = modelName;
        this.apiKey = apiKey;
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
            // Convert AgentInputItem to message
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
                    vercelTools[t.name] = {
                        description: t.description,
                        parameters: t.parameters,
                        execute: async (args) => {
                            // This part is tricky because Runner handles tool execution usually.
                            // But for Vercel AI SDK 'generateText', it can auto-execute if provided.
                            // However, @openai/agents handles the loop itself.
                            // So we just return tool calls to the Runner.
                            return null;
                        }
                    };
                }
            });
        }

        try {
            const modelInstance = this.google(this.modelName, {
                apiKey: this.apiKey
            });

            // Use generateText from Vercel AI SDK
            const result = await generateText({
                model: modelInstance,
                messages: messages,
                tools: vercelTools,
                toolChoice: 'auto',
            });

            // Convert back to ModelResponse format
            const output = [];

            // Add text output
            if (result.text) {
                output.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: result.text }],
                    status: 'completed'
                });
            }

            // Add tool calls
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
        // Simple non-streaming implementation for now as a fallback
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
