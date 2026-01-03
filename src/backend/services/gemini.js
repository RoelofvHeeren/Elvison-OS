import { GoogleGenerativeAI } from '@google/generative-ai';

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
 * Build Gemini function declarations in the format expected by Google's official SDK
 * Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
 */
function buildFunctionDeclarations(tools) {
    if (!tools || tools.length === 0) return null;

    const functionDeclarations = [];

    for (const t of tools) {
        if (t.type === 'function') {
            let parameters = {
                type: "object",
                properties: {},
                required: []
            };

            // Define parameters based on tool name
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
            } else if (t.name === 'scan_site_structure') {
                parameters = {
                    type: "object",
                    properties: {
                        domain: {
                            type: "string",
                            description: "Domain to scan for links"
                        }
                    },
                    required: ["domain"]
                };
            } else if (t.name === 'scrape_specific_pages') {
                parameters = {
                    type: "object",
                    properties: {
                        urls: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of URLs to scrape"
                        }
                    },
                    required: ["urls"]
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
                description: t.description || `Tool: ${t.name}`,
                parameters: parameters
            });
        }
    }

    if (functionDeclarations.length === 0) return null;
    return functionDeclarations;
}

/**
 * GeminiModel Implementation for @openai/agents
 * Uses Google's official SDK (@google/generative-ai) directly
 */
export class GeminiModel {
    constructor(apiKey, modelName = 'gemini-2.0-flash') {
        if (!apiKey) throw new Error("Missing API Key for GeminiModel");
        this.modelName = modelName;
        this.apiKey = typeof apiKey === 'string' ? apiKey.trim().replace(/[\s\r\n\t]/g, '') : apiKey;
        this.genAI = new GoogleGenerativeAI(this.apiKey);
    }

    async getResponse(request) {
        const { systemInstructions, input, tools, outputType } = request;

        // Check if "googleSearch" is requested in tools
        const hasGoogleSearch = tools?.some(t => t.name === 'googleSearch');

        // Build function declarations for OTHER tools
        const otherTools = tools?.filter(t => t.name !== 'googleSearch') || [];
        const functionDeclarations = buildFunctionDeclarations(otherTools);

        // Get model with optional tools
        const modelConfig = { tools: [] };

        if (hasGoogleSearch) {
            modelConfig.tools.push({ googleSearch: {} });
            console.log('[GeminiModel] Enabled Google Search Grounding');
        }

        if (functionDeclarations && functionDeclarations.length > 0) {
            modelConfig.tools.push({ functionDeclarations });
            console.log(`[GeminiModel] Using ${functionDeclarations.length} custom tools:`, functionDeclarations.map(f => f.name));
            console.log(`[GeminiModel] Tool declarations:`, JSON.stringify(functionDeclarations, null, 2));
        }

        // If tools array represents NO tools, remove the property to avoid errors
        if (modelConfig.tools.length === 0) {
            delete modelConfig.tools;
        }

        const model = this.genAI.getGenerativeModel({
            model: this.modelName,
            ...modelConfig
        });

        // Build content parts
        const contents = [];

        // Add system instruction as first user message (Gemini doesn't have a separate system role)
        let systemContent = 'You must respond with ONLY valid JSON. Do not include explanations, markdown, code blocks, or any text before or after the JSON.';
        if (systemInstructions) {
            systemContent += '\n\n' + systemInstructions;
        }

        if (Array.isArray(input)) {
            input.forEach(item => {
                if (item.content && Array.isArray(item.content)) {
                    const textContent = item.content.find(c => c.type === 'text' || c.type === 'output_text')?.text || "";
                    if (textContent) {
                        contents.push({
                            role: item.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: textContent }]
                        });
                    }
                } else if (item.content && typeof item.content === 'string') {
                    contents.push({
                        role: item.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: item.content }]
                    });
                }
            });
        } else if (typeof input === 'string') {
            contents.push({
                role: 'user',
                parts: [{ text: systemContent + '\n\n' + input }]
            });
        }

        // If no contents built from input, create one from system
        if (contents.length === 0) {
            contents.push({
                role: 'user',
                parts: [{ text: systemContent }]
            });
        }

        try {
            console.log(`[GeminiModel] Calling ${this.modelName} with ${contents.length} messages`);

            const result = await model.generateContent({
                contents: contents
            });

            const response = result.response;
            const output = [];

            // DETAILED LOGGING: Show exactly what Gemini returned
            const candidate = response?.candidates?.[0];
            console.log(`[GeminiModel] Response received. Candidate parts:`, JSON.stringify(candidate?.content?.parts?.map(p => ({
                hasText: !!p.text,
                hasFunctionCall: !!p.functionCall,
                functionName: p.functionCall?.name || null,
                textSnippet: p.text?.substring(0, 100) || null
            })), null, 2));

            // Check for function calls
            if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                    if (part.functionCall) {
                        console.log(`[GeminiModel] Function call detected: ${part.functionCall.name}`);
                        output.push({
                            type: 'tool_call',
                            toolCallId: `call_${Date.now()}`,
                            name: part.functionCall.name,
                            parameters: part.functionCall.args || {}
                        });
                    } else if (part.text) {
                        const cleanText = extractJson(part.text);
                        output.push({
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: cleanText }],
                            status: 'completed'
                        });
                    }
                }
            }

            // Get usage metadata
            const usageMetadata = response.usageMetadata || {};
            const groundingMetadata = candidate?.groundingMetadata;

            return {
                usage: {
                    promptTokens: usageMetadata.promptTokenCount || 0,
                    completionTokens: usageMetadata.candidatesTokenCount || 0,
                    totalTokens: usageMetadata.totalTokenCount || 0
                },
                groundingMetadata,
                output: output
            };

        } catch (e) {
            console.error("[GeminiModel] Error:", e.message);
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
