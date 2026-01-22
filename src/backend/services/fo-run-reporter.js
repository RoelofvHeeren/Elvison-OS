/**
 * Family Office Run Reporter
 * 
 * Generates detailed metrics and insights from FO discovery/qualification runs
 * Essential for monitoring quality and tuning the pipeline
 */

export class FORunReporter {
    constructor() {
        this.stats = {
            total_discovered: 0,
            heuristics_rejected_as_wealth: 0,
            heuristics_rejected_as_fund: 0,
            heuristics_passed: 0,
            heuristics_uncertain: 0,
            llm_classified_fo: 0,
            llm_classified_wealth_manager: 0,
            llm_classified_fund: 0,
            llm_classified_operator: 0,
            llm_classified_unknown: 0,
            approved_count: 0,
            review_count: 0,
            rejected_count: 0,
            total_cost_usd: 0.0,
            avg_confidence: 0.0,
            avg_match_score: 0.0,
            execution_time_seconds: 0,
            errors: []
        };
        
        this.details = {
            approved: [],
            review: [],
            rejected: [],
            errors: []
        };
        
        this.startTime = Date.now();
    }
    
    recordHeuristicCheck(result) {
        this.stats.total_discovered++;
        
        if (result.decision === 'REJECT') {
            if (result.entity_type === 'WEALTH_MANAGER') {
                this.stats.heuristics_rejected_as_wealth++;
            } else if (result.entity_type === 'INVESTMENT_FUND') {
                this.stats.heuristics_rejected_as_fund++;
            } else {
                this.stats.heuristics_rejected_as_wealth++;
            }
        } else if (result.decision === 'PASS') {
            this.stats.heuristics_passed++;
        } else {
            this.stats.heuristics_uncertain++;
        }
    }
    
    recordEntityClassification(companyName, classification) {
        switch (classification.entity_type) {
            case 'FAMILY_OFFICE':
                this.stats.llm_classified_fo++;
                break;
            case 'WEALTH_MANAGER':
                this.stats.llm_classified_wealth_manager++;
                break;
            case 'INVESTMENT_FUND':
                this.stats.llm_classified_fund++;
                break;
            case 'OPERATOR':
                this.stats.llm_classified_operator++;
                break;
            default:
                this.stats.llm_classified_unknown++;
        }
    }
    
    recordFinalStatus(companyName, fo_status, score, confidence) {
        if (fo_status === 'APPROVED') {
            this.stats.approved_count++;
            this.details.approved.push({ companyName, score, confidence });
        } else if (fo_status === 'REVIEW') {
            this.stats.review_count++;
            this.details.review.push({ companyName, score, confidence });
        } else {
            this.stats.rejected_count++;
            this.details.rejected.push({ companyName, score, confidence });
        }
        
        if (score) {
            this.stats.avg_match_score = (this.stats.avg_match_score * (this.stats.approved_count + this.stats.review_count + this.stats.rejected_count - 1) + score) / 
                (this.stats.approved_count + this.stats.review_count + this.stats.rejected_count);
        }
        if (confidence) {
            this.stats.avg_confidence = (this.stats.avg_confidence * (this.stats.approved_count + this.stats.review_count + this.stats.rejected_count - 1) + confidence) / 
                (this.stats.approved_count + this.stats.review_count + this.stats.rejected_count);
        }
    }
    
    recordError(company, error) {
        this.stats.errors.push(error);
        this.details.errors.push({ company, error });
    }
    
    recordCost(costUsd) {
        this.stats.total_cost_usd += costUsd;
    }
    
    finalize() {
        this.stats.execution_time_seconds = (Date.now() - this.startTime) / 1000;
        
        return {
            timestamp: new Date().toISOString(),
            duration_seconds: this.stats.execution_time_seconds,
            summary: {
                total_discovered: this.stats.total_discovered,
                heuristic_analysis: {
                    rejected_wealth_managers: this.stats.heuristics_rejected_as_wealth,
                    rejected_investment_funds: this.stats.heuristics_rejected_as_fund,
                    passed_firewall: this.stats.heuristics_passed,
                    uncertain_requiring_llm: this.stats.heuristics_uncertain,
                    firewall_efficiency: `${(((this.stats.heuristics_rejected_as_wealth + this.stats.heuristics_rejected_as_fund) / this.stats.total_discovered) * 100).toFixed(1)}% rejected before LLM`
                },
                llm_classification: {
                    classified_as_fo: this.stats.llm_classified_fo,
                    classified_as_wealth_manager: this.stats.llm_classified_wealth_manager,
                    classified_as_fund: this.stats.llm_classified_fund,
                    classified_as_operator: this.stats.llm_classified_operator,
                    classified_as_unknown: this.stats.llm_classified_unknown
                },
                qualification_results: {
                    approved: this.stats.approved_count,
                    review: this.stats.review_count,
                    rejected: this.stats.rejected_count,
                    approval_rate: `${((this.stats.approved_count / (this.stats.approved_count + this.stats.review_count + this.stats.rejected_count)) * 100).toFixed(1)}%`
                },
                quality_metrics: {
                    avg_confidence: this.stats.avg_confidence.toFixed(2),
                    avg_match_score: this.stats.avg_match_score.toFixed(2),
                    total_errors: this.stats.errors.length,
                    error_rate: `${((this.stats.errors.length / this.stats.total_discovered) * 100).toFixed(1)}%`
                },
                cost_analysis: {
                    total_cost_usd: this.stats.total_cost_usd.toFixed(2),
                    cost_per_discovery: (this.stats.total_cost_usd / this.stats.total_discovered).toFixed(4),
                    cost_per_approved: this.stats.approved_count > 0 ? 
                        (this.stats.total_cost_usd / this.stats.approved_count).toFixed(4) : 
                        'N/A'
                }
            },
            top_approved: this.details.approved.slice(0, 10),
            top_review: this.details.review.slice(0, 10),
            errors: this.details.errors.slice(0, 5)
        };
    }
    
    /**
     * Export as JSON for archiving
     */
    toJSON() {
        return {
            stats: this.stats,
            details: this.details,
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Generate human-readable markdown report
     */
    toMarkdown() {
        const report = this.finalize();
        
        let md = `# Family Office Run Report\n`;
        md += `**Generated:** ${report.timestamp}\n`;
        md += `**Duration:** ${report.duration_seconds.toFixed(1)}s\n\n`;
        
        md += `## Summary\n`;
        md += `- **Total Discovered:** ${report.summary.total_discovered}\n`;
        md += `- **Approved:** ${report.summary.qualification_results.approved} (${report.summary.qualification_results.approval_rate})\n`;
        md += `- **Under Review:** ${report.summary.qualification_results.review}\n`;
        md += `- **Rejected:** ${report.summary.qualification_results.rejected}\n\n`;
        
        md += `## Firewall Efficiency\n`;
        md += `- **Rejected Before LLM:** ${report.summary.heuristic_analysis.firewall_efficiency}\n`;
        md += `  - Wealth Managers: ${report.summary.heuristic_analysis.rejected_wealth_managers}\n`;
        md += `  - Investment Funds: ${report.summary.heuristic_analysis.rejected_investment_funds}\n`;
        md += `  - Passed Firewall:** ${report.summary.heuristic_analysis.passed_firewall}\n\n`;
        
        md += `## LLM Classification\n`;
        md += `- **Family Offices:** ${report.summary.llm_classification.classified_as_fo}\n`;
        md += `- **Wealth Managers:** ${report.summary.llm_classification.classified_as_wealth_manager}\n`;
        md += `- **Investment Funds:** ${report.summary.llm_classification.classified_as_fund}\n`;
        md += `- **Operators:** ${report.summary.llm_classification.classified_as_operator}\n\n`;
        
        md += `## Quality Metrics\n`;
        md += `- **Avg Confidence:** ${report.summary.quality_metrics.avg_confidence}\n`;
        md += `- **Avg Match Score:** ${report.summary.quality_metrics.avg_match_score}/10\n`;
        md += `- **Error Rate:** ${report.summary.quality_metrics.error_rate}\n\n`;
        
        md += `## Cost Analysis\n`;
        md += `- **Total Cost:** $${report.summary.cost_analysis.total_cost_usd}\n`;
        md += `- **Cost/Discovery:** $${report.summary.cost_analysis.cost_per_discovery}\n`;
        md += `- **Cost/Approved FO:** $${report.summary.cost_analysis.cost_per_approved}\n\n`;
        
        if (report.top_approved.length > 0) {
            md += `## Top Approved Family Offices\n`;
            report.top_approved.forEach((fo, i) => {
                md += `${i+1}. ${fo.companyName} (Confidence: ${fo.confidence.toFixed(2)}, Score: ${fo.score.toFixed(1)})\n`;
            });
            md += '\n';
        }
        
        if (report.errors.length > 0) {
            md += `## Recent Errors\n`;
            report.errors.forEach((err, i) => {
                md += `${i+1}. ${err.company}: ${err.error}\n`;
            });
        }
        
        return md;
    }
}

export default FORunReporter;
