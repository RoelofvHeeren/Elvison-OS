import { retryWithBackoff } from '../utils/retry.js';

export class OutreachService {
    constructor(runner) {
        this.runner = runner;
    }

    /**
     * Generates outreach messages for a list of leads using the provided agent configuration.
     * @param {Array} leads - List of lead objects.
     * @param {Object} agentConfig - Configuration for the outreach agent (model, instructions, etc.).
     * @param {Function} logCallback - Optional callback for logging progress.
     * @returns {Promise<Array>} - List of leads with generated messages.
     */
    async generateOutreach(leads, agentConfig, logCallback = () => { }) {
        if (!leads || leads.length === 0) return [];

        const BATCH_SIZE = 1;
        const chunks = [];
        for (let i = 0; i < leads.length; i += BATCH_SIZE) {
            chunks.push(leads.slice(i, i + BATCH_SIZE));
        }

        logCallback(`Generating content for ${leads.length} leads in ${chunks.length} batches...`);

        let finalLeads = [];

        // Define the agent structure dynamically based on config or defaults
        // Note: The runner expects an agent object. We construct a minimal one here provided the runner handles it.
        // If the runner requires a pre-built agent instance logic, we might need to duplicate that setup.
        // Assuming the caller passes a valid 'outreachCreator' agent object OR we reconstruct it.
        // Actually, to keep it simple for now, the caller should pass the AGENT OBJECT or we use a default definition here.
        // But `workflow.js` builds agents using `agentFactory`.
        // Let's pass the 'agent' object itself to this method or the constructor? 
        // Better: Pass the agent object to this method.

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // Optimization: Strip heavy raw_data
            const safeChunk = chunk.map(l => {
                const { raw_data, ...rest } = l;
                return rest;
            });

            const input = [{
                role: "user",
                content: JSON.stringify({
                    task: "Draft outreach messages for these leads.",
                    leads: safeChunk
                })
            }];

            try {
                logCallback(`Batch ${i + 1}/${chunks.length} generating...`);
                // We assume 'agentConfig' IS the executable agent instance for the runner
                const res = await retryWithBackoff(() => this.runner.run(agentConfig, input));

                if (res.finalOutput && res.finalOutput.leads) {
                    finalLeads.push(...res.finalOutput.leads);
                } else {
                    console.warn(`[OutreachService] Batch ${i + 1} failed to return structured leads.`);
                    finalLeads.push(...chunk);
                }
            } catch (err) {
                console.error(`[OutreachService] Batch ${i + 1} failed: ${err.message}`);
                finalLeads.push(...chunk);
            }
        }

        return finalLeads;
    }
}
