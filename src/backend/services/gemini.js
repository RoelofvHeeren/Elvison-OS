import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

/**
 * Build Gemini-native tools format
 * This bypasses ai-sdk's tool abstraction completely
 */
function buildGeminiNativeTools(tools) {
    if (!tools || tools.length === 0) return undefined;

    const functionDeclarations = [];

    for (const t of tools) {
        if (t.type === 'function') {
            // Hardcoded schemas per tool - Gemini needs boring and explicit
            let parameters;

            if (t.name === 'google_search_and_extract') {
                parameters = {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Google search query"
                        }
                    },
                    required: ["query"]
                };
            } else if (t.name === 'scrape_company_website') {
                parameters = {
                    type: "object",
                    properties: {
                        domain: {
                            type: "string",
                            description: "Domain to scrape"
                        }
                    },
                    required: ["domain"]
                };
            } else {
                parameters = {
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

            functionDeclarations.push({
                name: t.name,
                description: t.description || "No description",
                parameters: parameters
            });
        }
    }

    if (functionDeclarations.length === 0) return undefined;

    // Return in Gemini-native format
    return [{ functionDeclarations }];
}

/**
 * GeminiModel Implementation for @openai/agents
 * Uses Gemini-native tool format to bypass ai-sdk wrapper issues
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

        // Build Gemini-native tools
        const geminiTools = buildGeminiNativeTools(tools);

        if (geminiTools) {
            console.log(`[GeminiModel] Native tools:`, JSON.stringify(geminiTools));
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            // Use generateText WITHOUT ai-sdk's tools abstraction
            // Pass tools in Gemini-native format via providerOptions
            const generateOptions = {
                model: modelInstance,
                messages: messages,
            };

            // If we have tools, pass them via experimental_providerMetadata
            // This bypasses ai-sdk's tool wrapping
            if (geminiTools) {
                generateOptions.experimental_providerMetadata = {
                    google: {
                        tools: geminiTools
                    }
                };
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

            // Check for function calls in the response
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
