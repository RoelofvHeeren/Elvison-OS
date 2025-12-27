import { Agent, Runner } from "@openai/agents";
import { query } from "../../db/index.js";

/**
 * Optimization Service
 * Analyzes run feedback and updates the ICP configuration (agent_config) 
 * to improve future results.
 */
export class OptimizationService {
    constructor(userId, icpId) {
        this.userId = userId;
        this.icpId = icpId;
    }

    /**
     * Main entry point to optimize an ICP.
     */
    async optimize() {
        console.log(`🧠 Optimizing ICP ${this.icpId} for user ${this.userId}...`);

        // 1. Fetch Feedback
        const feedback = await this.getFeedback();
        if (feedback.length === 0) {
            return { success: false, message: "No feedback available to optimize." };
        }

        // 2. Fetch Current Config
        const icp = await this.getIcp();
        let currentAgentConfig = icp.agent_config || {};

        // 3. Analyze Feedback
        const analysis = await this.analyzeFeedback(feedback, currentAgentConfig);

        // 4. Update Agent Config
        const newAgentConfig = this.applyOptimization(currentAgentConfig, analysis);

        // 5. Persist Changes
        await this.updateIcpConfig(newAgentConfig);

        console.log(`✅ Optimization complete. New constraints added.`);
        return {
            success: true,
            analysis,
            newConfig: newAgentConfig
        };
    }

    async getFeedback() {
        // Get all feedback for this ICP that hasn't been "applied" yet?
        // For MVP, we'll just look at the last 50 feedback items to keep context small
        // or simple "all time" approach if volume is low.
        const { rows } = await query(
            `SELECT * FROM run_feedback 
             WHERE icp_id = $1 
             ORDER BY created_at DESC LIMIT 100`,
            [this.icpId]
        );
        return rows;
    }

    async getIcp() {
        const { rows } = await query(
            `SELECT * FROM icps WHERE id = $1 AND user_id = $2`,
            [this.icpId, this.userId]
        );
        if (rows.length === 0) throw new Error("ICP not found");
        return rows[0];
    }

    async analyzeFeedback(feedbackItems, currentConfig) {
        // Group feedback
        const positive = feedbackItems.filter(f => f.grade === 'positive');
        const negative = feedbackItems.filter(f => f.grade === 'negative');

        console.log(`📊 Feedback Analysis: ${positive.length} Positive, ${negative.length} Negative`);

        if (negative.length === 0 && positive.length === 0) {
            return { exclusions: [], refinements: [] };
        }

        // Construct LLM Prompt
        const negativeNotes = negative.map(f => `- [${f.entity_type}] ${f.entity_identifier}: ${f.notes || 'No notes'}`).join('\n');
        const positiveNotes = positive.map(f => `- [${f.entity_type}] ${f.entity_identifier}: ${f.notes || 'No notes'}`).join('\n');

        const currentInstructions = currentConfig.base_instructions || "Default Instructions";

        const systemPrompt = `
You are an "AI Optimization Engineer" for a lead generation system.
Your goal is to IMPROVE the search criteria and agent instructions based on user feedback.

CURRENT INSTRUCTIONS:
"${currentInstructions}"

USER FEEDBACK (Last Run):
--- NEGATIVE (Avoid these) ---
${negativeNotes}

--- POSITIVE (Find more like these) ---
${positiveNotes}

TASK:
1. Identification: What distinct patterns appear in the NEGATIVE feedback? (e.g., "Companies are too small", "Wrong region", "exclude LLCs").
2. Identification: What distinct patterns appear in the POSITIVE feedback?
3. Action: Generate specific "Exclusion Rules" and "Refinement Keywords".

OUTPUT SCHEMA (JSON):
{
  "analysis_summary": "Short explanation of what went wrong/right.",
  "new_exclusion_keywords": ["keyword1", "keyword2"],
  "new_qualifiers": ["must have X", "focus on Y"],
  "suggested_instruction_update": "A rewritten, improved version of the CURRENT INSTRUCTIONS that incorporates these learnings."
}
`;

        // Run Agent/LLM
        // We'll use a simple Runner here purely for the LLM call.
        const runner = new Runner();
        // Create a temporary agent for this one-off task
        const optimizerAgent = new Agent({
            name: "Optimizer",
            instructions: "You are a JSON-only output machine. Output ONLY valid JSON matching the schema.",
            model: "gpt-4o",
            tools: [] // No tools needed, just reasoning
        });

        const result = await runner.run(optimizerAgent, [{ role: "user", content: systemPrompt }]);

        // Parse JSON output
        let parsed = {};
        try {
            // Remove markdown code blocks if present
            const cleanText = result.finalOutput.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleanText);
        } catch (e) {
            console.error("Failed to parse optimizer output", e);
            parsed = {
                analysis_summary: "Failed to parse AI suggestions.",
                suggested_instruction_update: currentInstructions
            };
        }

        return parsed;
    }

    applyOptimization(currentConfig, analysis) {
        // Merge the new suggestions into the config
        // We might simply replace the "custom_instructions" or "agent_prompts"

        return {
            ...currentConfig,
            // Keep existing fields
            // Update instructions
            optimized_instructions: analysis.suggested_instruction_update,
            // Append exclusions (ensure unique)
            exclusions: [...(currentConfig.exclusions || []), ...(analysis.new_exclusion_keywords || [])],
            last_optimized_at: new Date().toISOString(),
            optimization_summary: analysis.analysis_summary
        };
    }

    async updateIcpConfig(newConfig) {
        await query(
            `UPDATE icps SET agent_config = $1, updated_at = NOW() WHERE id = $2`,
            [newConfig, this.icpId]
        );
    }
}
