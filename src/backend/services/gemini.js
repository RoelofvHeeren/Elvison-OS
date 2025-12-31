import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

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

        // ... (messages conversion logic stays the same)
        const messages = [];
        if (systemInstructions) {
            messages.push({ role: 'system', content: systemInstructions });
        }

        if (Array.isArray(input)) {
            input.forEach(item => {
                // OpenAI Agents SDK sends messages in this structure
                if (item.content && Array.isArray(item.content)) {
                    const textContent = item.content.find(c => c.type === 'text' || c.type === 'output_text')?.text || "";
                    if (textContent) {
                        messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: textContent });
                    }
                }
                // Fallback for simpler message objects
                else if (item.content && typeof item.content === 'string') {
                    messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content });
                }
            });
        } else if (typeof input === 'string') {
            messages.push({ role: 'user', content: input });
        }

        const vercelTools = {};
        if (tools && tools.length > 0) {
            tools.forEach(t => {
                if (t.type === 'function') {
                    vercelTools[t.name] = {
                        description: t.description,
                        parameters: t.parameters
                    };
                }
            });
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_AI) {
                console.log(`[GeminiModel] Requesting ${this.modelName} with ${messages.length} messages.`);
            }

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
