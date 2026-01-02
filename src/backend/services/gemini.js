import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, tool } from 'ai';
import { z } from 'zod';

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
 * GeminiModel Implementation for @openai/agents
 * Uses Vercel AI SDK's native tool format with Zod schemas
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

        // Build Vercel AI SDK tools using Zod schemas directly
        // This is the officially supported way according to Vercel AI SDK docs
        const vercelTools = {};
        if (tools && tools.length > 0) {
            for (const t of tools) {
                if (t.type === 'function') {
                    // Create Zod schema based on tool name
                    let zodSchema;

                    if (t.name === 'google_search_and_extract') {
                        zodSchema = z.object({
                            query: z.string().describe("Google search query")
                        });
                    } else if (t.name === 'scrape_company_website') {
                        zodSchema = z.object({
                            domain: z.string().describe("Domain to scrape")
                        });
                    } else if (t.name === 'scan_site_structure') {
                        zodSchema = z.object({
                            domain: z.string().describe("Domain to scan for links")
                        });
                    } else if (t.name === 'scrape_specific_pages') {
                        zodSchema = z.object({
                            urls: z.array(z.string()).describe("List of URLs to scrape")
                        });
                    } else {
                        zodSchema = z.object({
                            input: z.string().describe("Input value")
                        });
                    }

                    vercelTools[t.name] = tool({
                        description: t.description || `Tool: ${t.name}`,
                        parameters: zodSchema
                    });
                }
            }
        }

        if (Object.keys(vercelTools).length > 0) {
            console.log(`[GeminiModel] Using ${Object.keys(vercelTools).length} tools with Zod schemas:`, Object.keys(vercelTools));
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
