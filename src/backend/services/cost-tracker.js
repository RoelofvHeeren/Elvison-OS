/**
 * API Cost Tracker Service
 * 
 * Tracks OpenAI API usage including:
 * - Tokens consumed (input/output)
 * - Estimated costs per model
 * - Per-agent and per-call breakdown
 */

// OpenAI Pricing (as of Dec 2024) - USD per 1M tokens
// Source: https://openai.com/api/pricing/
const MODEL_PRICING = {
    // GPT-4o Models
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
    'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },

    // GPT-4o Mini Models
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },

    // Gemini Models (Studio / Vertex)
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'gemini-1.5-pro': { input: 3.50, output: 10.50 },

    // Claude Models (Anthropic)
    'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },

    // Legacy/Other
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },

    // Default fallback
    'default': { input: 2.50, output: 10.00 }
};

/**
 * CostTracker class for tracking API usage during a workflow run
 */
export class CostTracker {
    constructor(runId = null) {
        this.runId = runId || `run_${Date.now()}`;
        this.calls = [];
        this.startTime = Date.now();
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this.totalCost = 0;
    }

    /**
     * Get pricing for a model
     */
    getPricing(model) {
        // Handle object models (like GeminiModel or ClaudeModel instances)
        let modelName = model;
        if (model && typeof model === 'object') {
            modelName = model.modelName || model.name || 'default';
        }

        // Ensure modelName is a string
        if (typeof modelName !== 'string') {
            modelName = String(modelName || 'default');
        }

        // Try exact match first
        if (MODEL_PRICING[modelName]) {
            return MODEL_PRICING[modelName];
        }

        // Try prefix match (e.g., 'gpt-4o-2024-11-20' -> 'gpt-4o')
        for (const key of Object.keys(MODEL_PRICING)) {
            if (modelName.startsWith(key)) {
                return MODEL_PRICING[key];
            }
        }

        // Fallback to default
        console.warn(`[CostTracker] Unknown model: ${modelName}, using default pricing`);
        return MODEL_PRICING['default'];
    }

    /**
     * Calculate cost for a given token count
     */
    calculateCost(model, inputTokens, outputTokens) {
        const pricing = this.getPricing(model);
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    }

    /**
     * Record an API call
     */
    recordCall({
        agent,
        model,
        inputTokens,
        outputTokens,
        duration,
        success = true,
        error = null,
        metadata = {}
    }) {
        const pricing = this.getPricing(model);
        const cost = this.calculateCost(model, inputTokens, outputTokens);

        // Standardize model name for record
        let modelName = model;
        if (model && typeof model === 'object') {
            modelName = model.modelName || model.name || 'unknown';
        }

        const callRecord = {
            id: `call_${this.calls.length + 1}`,
            timestamp: new Date().toISOString(),
            agent,
            model: modelName,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost,
            duration,
            success,
            error,
            metadata
        };

        this.calls.push(callRecord);
        this.totalInputTokens += inputTokens;
        this.totalOutputTokens += outputTokens;
        this.totalCost += cost;

        return callRecord;
    }

    /**
     * Get breakdown by agent
     */
    getAgentBreakdown() {
        const breakdown = {};

        for (const call of this.calls) {
            if (!breakdown[call.agent]) {
                breakdown[call.agent] = {
                    callCount: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    cost: 0,
                    avgDuration: 0,
                    errors: 0
                };
            }

            const agent = breakdown[call.agent];
            agent.callCount++;
            agent.inputTokens += call.inputTokens;
            agent.outputTokens += call.outputTokens;
            agent.totalTokens += call.totalTokens;
            agent.cost += call.cost;
            agent.avgDuration = ((agent.avgDuration * (agent.callCount - 1)) + call.duration) / agent.callCount;
            if (!call.success) agent.errors++;
        }

        return breakdown;
    }

    /**
     * Get breakdown by model
     */
    getModelBreakdown() {
        const breakdown = {};

        for (const call of this.calls) {
            if (!breakdown[call.model]) {
                breakdown[call.model] = {
                    callCount: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    cost: 0
                };
            }

            const model = breakdown[call.model];
            model.callCount++;
            model.inputTokens += call.inputTokens;
            model.outputTokens += call.outputTokens;
            model.totalTokens += call.totalTokens;
            model.cost += call.cost;
        }

        return breakdown;
    }

    /**
     * Get full summary
     */
    getSummary() {
        const duration = (Date.now() - this.startTime) / 1000;

        return {
            runId: this.runId,
            duration: `${duration.toFixed(2)}s`,
            totalCalls: this.calls.length,
            successfulCalls: this.calls.filter(c => c.success).length,
            failedCalls: this.calls.filter(c => !c.success).length,
            tokens: {
                input: this.totalInputTokens,
                output: this.totalOutputTokens,
                total: this.totalInputTokens + this.totalOutputTokens
            },
            cost: {
                total: this.totalCost,
                formatted: `$${this.totalCost.toFixed(4)}`
            },
            breakdown: {
                byAgent: this.getAgentBreakdown(),
                byModel: this.getModelBreakdown()
            },
            calls: this.calls
        };
    }

    /**
     * Get human-readable report
     */
    getReport() {
        const summary = this.getSummary();

        let report = `\n${'='.repeat(60)}\n`;
        report += `📊 API COST REPORT - Run: ${this.runId}\n`;
        report += `${'='.repeat(60)}\n\n`;

        report += `⏱️  Duration: ${summary.duration}\n`;
        report += `📞 Total Calls: ${summary.totalCalls} (${summary.successfulCalls} success, ${summary.failedCalls} failed)\n`;
        report += `🔤 Tokens: ${summary.tokens.total.toLocaleString()} (${summary.tokens.input.toLocaleString()} in / ${summary.tokens.output.toLocaleString()} out)\n`;
        report += `💰 Estimated Cost: ${summary.cost.formatted}\n`;

        report += `\n${'─'.repeat(40)}\n`;
        report += `📋 BREAKDOWN BY AGENT\n`;
        report += `${'─'.repeat(40)}\n`;

        for (const [agent, data] of Object.entries(summary.breakdown.byAgent)) {
            report += `\n🤖 ${agent}\n`;
            report += `   Calls: ${data.callCount}\n`;
            report += `   Tokens: ${data.totalTokens.toLocaleString()} (${data.inputTokens.toLocaleString()} in / ${data.outputTokens.toLocaleString()} out)\n`;
            report += `   Cost: $${data.cost.toFixed(4)}\n`;
            report += `   Avg Duration: ${data.avgDuration.toFixed(2)}s\n`;
            if (data.errors > 0) report += `   ⚠️ Errors: ${data.errors}\n`;
        }

        report += `\n${'─'.repeat(40)}\n`;
        report += `🏷️  BREAKDOWN BY MODEL\n`;
        report += `${'─'.repeat(40)}\n`;

        for (const [model, data] of Object.entries(summary.breakdown.byModel)) {
            report += `\n📦 ${model}\n`;
            report += `   Calls: ${data.callCount}\n`;
            report += `   Tokens: ${data.totalTokens.toLocaleString()}\n`;
            report += `   Cost: $${data.cost.toFixed(4)}\n`;
        }

        report += `\n${'─'.repeat(40)}\n`;
        report += `📝 INDIVIDUAL CALLS\n`;
        report += `${'─'.repeat(40)}\n`;

        for (const call of this.calls) {
            const status = call.success ? '✅' : '❌';
            report += `\n${status} ${call.id} - ${call.agent} (${call.model})\n`;
            report += `   Tokens: ${call.inputTokens} in / ${call.outputTokens} out\n`;
            report += `   Cost: $${call.cost.toFixed(6)} | Duration: ${call.duration.toFixed(2)}s\n`;
            if (call.error) report += `   Error: ${call.error}\n`;
        }

        report += `\n${'='.repeat(60)}\n`;

        return report;
    }
}

/**
 * Helper to extract token usage from OpenAI Agent SDK response
 * The @openai/agents library doesn't directly expose usage, but we can estimate
 * or hook into the underlying client
 */
export function extractTokenUsage(runResult) {
    // The Agent SDK's Runner.run() returns a RunResult object
    // We need to check if there's usage data available

    // Try to get from newItems (messages/tool calls)
    let inputTokens = 0;
    let outputTokens = 0;

    if (runResult.usage) {
        // Direct usage object (if available) - Handle both snake_case (OpenAI) and camelCase (Custom)
        inputTokens = runResult.usage.prompt_tokens || runResult.usage.promptTokens || 0;
        outputTokens = runResult.usage.completion_tokens || runResult.usage.completionTokens || 0;
    } else if (runResult.rawResponses) {
        // Sum up from raw responses
        for (const response of runResult.rawResponses) {
            if (response.usage) {
                inputTokens += response.usage.prompt_tokens || 0;
                outputTokens += response.usage.completion_tokens || 0;
            }
        }
    }

    // If we still don't have usage, estimate based on content length
    if (inputTokens === 0 && outputTokens === 0) {
        // Rough estimation: ~4 chars per token
        const inputText = JSON.stringify(runResult.input || []);
        const outputText = JSON.stringify(runResult.finalOutput || {});
        inputTokens = Math.ceil(inputText.length / 4);
        outputTokens = Math.ceil(outputText.length / 4);
    }

    return { inputTokens, outputTokens };
}

/**
 * Wrapper to run an agent with cost tracking
 */
export async function runAgentWithTracking(runner, agent, input, costTracker, settings = {}, metadata = {}) {
    const startTime = Date.now();
    let success = true;
    let error = null;
    let result = null;

    try {
        result = await runner.run(agent, input, settings);
    } catch (e) {
        success = false;
        error = e.message;
        throw e;
    } finally {
        const duration = (Date.now() - startTime) / 1000;
        const { inputTokens, outputTokens } = extractTokenUsage(result || {});

        costTracker.recordCall({
            agent: agent.name,
            model: agent.model || 'unknown',
            inputTokens,
            outputTokens,
            duration,
            success,
            error,
            metadata
        });
    }

    return result;
}

// Create a global instance for shared tracking
let globalCostTracker = null;

export function getGlobalCostTracker() {
    if (!globalCostTracker) {
        globalCostTracker = new CostTracker('global');
    }
    return globalCostTracker;
}

export function resetGlobalCostTracker() {
    globalCostTracker = new CostTracker('global');
    return globalCostTracker;
}

export default CostTracker;
