import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

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
 * Build Gemini-native tools format with UPPERCASE types as required by Gemini API
 * Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
 */
function buildGeminiNativeTools(tools) {
    if (!tools || tools.length === 0) return undefined;

    const functionDeclarations = [];

    for (const t of tools) {
        if (t.type === 'function') {
            // Build parameters with UPPERCASE types as required by Gemini
            const parameters = {
                type: "OBJECT",  // UPPERCASE required by Gemini!
                properties: {}
            };

            // Handle google_search_and_extract
            if (t.name === 'google_search_and_extract') {
                parameters.properties = {
                    query: {
                        type: "STRING",  // UPPERCASE!
                        description: "Google search query"
                    }
                };
                parameters.required = ["query"];
            }
            // Handle scrape_company_website
            else if (t.name === 'scrape_company_website') {
                parameters.properties = {
                    domain: {
                        type: "STRING",
                        description: "Domain to scrape"
                    }
                };
                parameters.required = ["domain"];
            }
            // Handle scan_site_structure
            else if (t.name === 'scan_site_structure') {
                parameters.properties = {
                    domain: {
                        type: "STRING",
                        description: "Domain to scan for links"
                    }
                };
                parameters.required = ["domain"];
            }
            // Handle scrape_specific_pages
            else if (t.name === 'scrape_specific_pages') {
                parameters.properties = {
                    urls: {
                        type: "ARRAY",
                        items: { type: "STRING" },
                        description: "List of URLs to scrape"
                    }
                };
                parameters.required = ["urls"];
            }
            // Default fallback
            else {
                parameters.properties = {
                    input: {
                        type: "STRING",
                        description: "Input value"
                    }
                };
                parameters.required = ["input"];
            }

            functionDeclarations.push({
                name: t.name,
                description: t.description || `Tool: ${t.name}`,
                parameters: parameters
            });
        }
    }

    if (functionDeclarations.length === 0) return undefined;
    return [{ functionDeclarations }];
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

        // Build Gemini-native tools with UPPERCASE types
        const geminiTools = buildGeminiNativeTools(tools);

        if (geminiTools) {
            console.log(`[GeminiModel] Gemini-native tools format:`, JSON.stringify(geminiTools, null, 2));
        }

        try {
            const modelInstance = this.googleProvider(this.modelName);

            const generateOptions = {
                model: modelInstance,
                messages: messages,
            };

            // Pass tools via experimental_providerMetadata for Gemini-native format
            if (geminiTools) {
                generateOptions.experimental_providerMetadata = {
                    google: {
                        functionCallingConfig: {
                            mode: 'AUTO'
                        },
                        tools: geminiTools
                    }
                };
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
