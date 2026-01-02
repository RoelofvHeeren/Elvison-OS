/**
 * Direct Agent Runner
 * 
 * Bypasses @openai/agents library to run agents with proper function calling.
 * Implements the agentic loop: call model → execute tools → feed results back → repeat
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Run an agent with function calling support
 * This implements the standard agentic loop without depending on @openai/agents
 * 
 * @param {object} config - Configuration object
 * @param {string} config.apiKey - Google API key
 * @param {string} config.modelName - Model name (e.g., 'gemini-2.0-flash')
 * @param {string} config.instructions - System instructions for the agent
 * @param {string} config.userMessage - The user's message/prompt
 * @param {Array} config.tools - Array of tool definitions with execute functions
 * @param {number} config.maxTurns - Maximum number of turns (default: 10)
 * @param {Function} config.logStep - Logging function (agentName, message)
 * @param {string} config.agentName - Name of the agent for logging
 * @returns {object} - { finalOutput: string, usage: { inputTokens, outputTokens, totalTokens } }
 */
export async function runGeminiAgent({
    apiKey,
    modelName = 'gemini-2.0-flash',
    instructions,
    userMessage,
    tools = [],
    maxTurns = 10,
    logStep = () => { },
    agentName = 'Agent'
}) {
    const genAI = new GoogleGenerativeAI(apiKey);

    // Build function declarations for Gemini
    const functionDeclarations = tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
            type: "object",
            properties: t.parameters?.properties || { input: { type: "string", description: "Input" } },
            required: t.parameters?.required || []
        }
    }));

    console.log(`[DirectRunner] Building model with ${functionDeclarations.length} tools:`, functionDeclarations.map(f => f.name));

    // Create model with tools - we'll use different configs per turn
    const baseModelConfig = {
        model: modelName
    };

    if (functionDeclarations.length > 0) {
        baseModelConfig.tools = [{ functionDeclarations }];
    }

    // Create two model instances:
    // 1. forcedToolModel - MUST call a tool (for first turn to ensure search happens)
    // 2. autoToolModel - CAN call a tool OR return text (for subsequent turns)
    const forcedToolConfig = {
        ...baseModelConfig,
        toolConfig: { functionCallingConfig: { mode: 'ANY' } }
    };
    const autoToolConfig = {
        ...baseModelConfig,
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
    };

    console.log(`[DirectRunner] Tool modes: Turn 1=ANY (forced), Turn 2+=AUTO (flexible)`);

    // Build conversation history - be explicit about needing to use tools
    const contents = [
        {
            role: 'user',
            parts: [{ text: `${instructions}\n\nIMPORTANT: You MUST use the google_search_and_extract tool to find real companies. Do NOT make up or hallucinate company names. After searching, return your findings as JSON.\n\n${userMessage}` }]
        }
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turn = 0;

    while (turn < maxTurns) {
        turn++;
        logStep(agentName, `Turn ${turn}/${maxTurns}`);

        // Use forced tool calling on turn 1, then auto mode for subsequent turns
        const modelConfig = turn === 1 ? forcedToolConfig : autoToolConfig;
        const model = genAI.getGenerativeModel(modelConfig);

        try {
            const result = await model.generateContent({ contents });
            const response = result.response;

            // Track tokens
            const usage = response.usageMetadata || {};
            totalInputTokens += usage.promptTokenCount || 0;
            totalOutputTokens += usage.candidatesTokenCount || 0;

            const candidate = response.candidates?.[0];
            if (!candidate?.content?.parts) {
                logStep(agentName, `⚠️ No response parts received`);
                break;
            }

            // Check for function calls
            const functionCalls = candidate.content.parts.filter(p => p.functionCall);
            const textParts = candidate.content.parts.filter(p => p.text);

            // If no function calls, we're done - return the text
            if (functionCalls.length === 0) {
                const finalText = textParts.map(p => p.text).join('\n');
                logStep(agentName, `✅ Completed with text response`);

                return {
                    finalOutput: finalText,
                    usage: {
                        inputTokens: totalInputTokens,
                        outputTokens: totalOutputTokens,
                        totalTokens: totalInputTokens + totalOutputTokens
                    }
                };
            }

            // Execute function calls
            const functionResponses = [];
            for (const fc of functionCalls) {
                const toolName = fc.functionCall.name;
                const toolArgs = fc.functionCall.args || {};

                logStep(agentName, `🔧 Calling tool: ${toolName}(${JSON.stringify(toolArgs)})`);

                // Find the tool
                const tool = tools.find(t => t.name === toolName);
                if (!tool) {
                    logStep(agentName, `❌ Tool not found: ${toolName}`);
                    functionResponses.push({
                        functionResponse: {
                            name: toolName,
                            response: { error: `Tool ${toolName} not found` }
                        }
                    });
                    continue;
                }

                // Execute the tool
                try {
                    const toolResult = await tool.execute(toolArgs);
                    logStep(agentName, `✓ Tool ${toolName} returned ${typeof toolResult === 'string' ? toolResult.length : 'object'} chars`);

                    functionResponses.push({
                        functionResponse: {
                            name: toolName,
                            response: { result: toolResult }
                        }
                    });
                } catch (toolError) {
                    logStep(agentName, `❌ Tool ${toolName} failed: ${toolError.message}`);
                    functionResponses.push({
                        functionResponse: {
                            name: toolName,
                            response: { error: toolError.message }
                        }
                    });
                }
            }

            // Add model response and function results to conversation
            contents.push({
                role: 'model',
                parts: candidate.content.parts
            });

            contents.push({
                role: 'user',
                parts: functionResponses
            });

        } catch (error) {
            logStep(agentName, `❌ Error: ${error.message}`);
            throw error;
        }
    }

    logStep(agentName, `⚠️ Max turns (${maxTurns}) reached without completion`);
    return {
        finalOutput: null,
        usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens
        }
    };
}

/**
 * Create a tool definition for use with runGeminiAgent
 */
export function createTool({ name, description, parameters, execute }) {
    return {
        name,
        description,
        parameters,
        execute
    };
}

export default { runGeminiAgent, createTool };
