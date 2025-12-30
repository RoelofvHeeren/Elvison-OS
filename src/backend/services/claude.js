import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

/**
 * ClaudeModel Implementation for @openai/agents
 * This wraps the Vercel AI SDK Anthropic provider to satisfy the Model interface.
 */
export class ClaudeModel {
    constructor(apiKey, modelName = 'claude-3-5-sonnet-20240620') {
        if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for ClaudeModel");
        this.anthropic = anthropic;
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
                    };
                }
            });
        }

        try {
            const modelInstance = this.anthropic(this.modelName, {
                apiKey: this.apiKey
            });

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
