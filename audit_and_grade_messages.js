#!/usr/bin/env node

/**
 * Comprehensive Message Audit & Grading Script
 * 
 * Tasks:
 * 1. Identify all leads with missing messages
 * 2. Flag them for manual review
 * 3. Grade existing messages based on quality criteria
 */

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Message quality grading criteria
function gradeMessage(lead) {
    const { connection_request, email_message, email_subject, research_fact, research_fact_type, outreach_status, person_name } = lead;

    let score = 0;
    let issues = [];
    let strengths = [];

    const firstName = person_name ? person_name.split(' ')[0] : 'there';

    // === CRITERION 1: Message Existence (40 points) ===
    if (!connection_request || connection_request.trim().length === 0) {
        issues.push('Missing LinkedIn message');
    } else {
        score += 15;
        if (connection_request.length <= 300) {
            score += 5;
            strengths.push('LinkedIn message within character limit');
        } else {
            issues.push(`LinkedIn message too long (${connection_request.length} chars)`);
        }
    }

    if (!email_message || email_message.trim().length === 0) {
        issues.push('Missing email body');
    } else {
        score += 15;
        strengths.push('Has email body');
    }

    if (!email_subject || email_subject.trim().length === 0) {
        issues.push('Missing email subject');
    } else {
        score += 5;
        strengths.push('Has email subject');
    }

    // === CRITERION 2: Research Fact Quality (30 points) ===
    if (!research_fact || research_fact.trim().length === 0) {
        issues.push('No research fact');
    } else {
        score += 10;

        // Check fact specificity
        if (research_fact.length > 20 && research_fact.length < 200) {
            score += 5;
            strengths.push('Research fact has good length');
        }

        // High-value fact types
        if (research_fact_type === 'DEAL') {
            score += 15;
            strengths.push('Named deal fact (highest value)');
        } else if (research_fact_type === 'SCALE') {
            score += 10;
            strengths.push('Scale fact (specific numbers)');
        } else if (research_fact_type === 'THESIS') {
            score += 5;
            strengths.push('Thesis/strategy fact');
        } else if (research_fact_type === 'GENERAL') {
            score += 3;
            issues.push('Generic fact (less specific)');
        }
    }

    // === CRITERION 3: Message Quality (30 points) ===
    if (connection_request) {
        // Check for personalization
        const personalizationIndicators = ['recently', 'noticed', 'saw that', 'came across', 'reviewing'];
        const hasPersonalization = personalizationIndicators.some(ind =>
            connection_request.toLowerCase().includes(ind)
        );

        if (hasPersonalization) {
            score += 5;
            strengths.push('LinkedIn message shows personalization');
        } else {
            issues.push('LinkedIn message lacks personalization cues');
        }

        // Check for specific fact mention
        if (research_fact && connection_request.includes(research_fact.substring(0, 20))) {
            score += 5;
            strengths.push('LinkedIn message references research fact');
        }

        // Check for micro-hook (LP/co-GP)
        if (connection_request.includes('LP') || connection_request.includes('co-GP')) {
            score += 5;
            strengths.push('Includes fund structure micro-hook');
        }
    }

    if (email_message) {
        // Check for appropriate length
        if (email_message.length >= 200 && email_message.length <= 1000) {
            score += 5;
            strengths.push('Email body has appropriate length');
        } else if (email_message.length < 200) {
            issues.push('Email too short');
        } else {
            issues.push('Email too long');
        }

        // Check for company name
        if (lead.company_name && email_message.includes(lead.company_name)) {
            score += 5;
            strengths.push('Email mentions company name');
        }

        // Check for recipient name
        if (firstName && email_message.includes(firstName)) {
            score += 5;
            strengths.push('Email addresses recipient by name');
        }
    }

    // === FINAL GRADE ===
    let grade = 'F';
    if (score >= 90) grade = 'A+';
    else if (score >= 85) grade = 'A';
    else if (score >= 80) grade = 'A-';
    else if (score >= 75) grade = 'B+';
    else if (score >= 70) grade = 'B';
    else if (score >= 65) grade = 'B-';
    else if (score >= 60) grade = 'C+';
    else if (score >= 55) grade = 'C';
    else if (score >= 50) grade = 'C-';
    else if (score >= 40) grade = 'D';

    return { score, grade, issues, strengths };
}

async function auditAndGradeMessages() {
    console.log('🔍 Starting Comprehensive Message Audit & Grading...\n');

    try {
        // === STEP 1: Identify leads with missing messages ===
        console.log('📋 Step 1: Identifying leads with missing messages...\n');

        const missingMessagesQuery = await pool.query(`
            SELECT id, company_name, person_name, 
                   connection_request, email_message, email_subject,
                   research_fact, research_fact_type, outreach_status, status
            FROM leads
            WHERE (connection_request IS NULL OR connection_request = '' 
                   OR email_message IS NULL OR email_message = ''
                   OR email_subject IS NULL OR email_subject = '')
              AND status != 'DISQUALIFIED'
              AND status != 'MANUAL_REVIEW'
            ORDER BY created_at DESC
        `);

        const missingCount = missingMessagesQuery.rows.length;
        console.log(`⚠️  Found ${missingCount} leads with missing messages\n`);

        if (missingCount > 0) {
            // Flag for manual review
            console.log('🏷️  Flagging these leads for MANUAL_REVIEW...');

            await pool.query(`
                UPDATE leads
                SET status = 'MANUAL_REVIEW',
                    outreach_status = 'NEEDS_RESEARCH'
                WHERE (connection_request IS NULL OR connection_request = '' 
                       OR email_message IS NULL OR email_message = ''
                       OR email_subject IS NULL OR email_subject = '')
                  AND status != 'DISQUALIFIED'
                  AND status != 'MANUAL_REVIEW'
            `);

            console.log(`✅ Flagged ${missingCount} leads as MANUAL_REVIEW\n`);

            // Show sample of missing messages
            console.log('Sample of leads flagged for manual review:');
            missingMessagesQuery.rows.slice(0, 10).forEach((lead, idx) => {
                const missing = [];
                if (!lead.connection_request) missing.push('LinkedIn');
                if (!lead.email_message) missing.push('Email Body');
                if (!lead.email_subject) missing.push('Email Subject');
                console.log(`  ${idx + 1}. ${lead.person_name} @ ${lead.company_name} - Missing: ${missing.join(', ')}`);
            });
            console.log('');
        }

        // === STEP 2: Grade all leads with complete messages ===
        console.log('📊 Step 2: Grading all leads with complete messages...\n');

        const allLeadsQuery = await pool.query(`
            SELECT id, company_name, person_name,
                   connection_request, email_message, email_subject,
                   research_fact, research_fact_type, outreach_status
            FROM leads
            WHERE connection_request IS NOT NULL AND connection_request != ''
              AND email_message IS NOT NULL AND email_message != ''
              AND status != 'DISQUALIFIED'
            ORDER BY created_at DESC
        `);

        const totalLeads = allLeadsQuery.rows.length;
        console.log(`📈 Grading ${totalLeads} leads with complete messages...\n`);

        const gradeDistribution = {
            'A+': 0, 'A': 0, 'A-': 0,
            'B+': 0, 'B': 0, 'B-': 0,
            'C+': 0, 'C': 0, 'C-': 0,
            'D': 0, 'F': 0
        };

        const factTypeDistribution = {
            'DEAL': 0,
            'SCALE': 0,
            'THESIS': 0,
            'GENERAL': 0,
            'MANUAL': 0,
            'null': 0
        };

        let totalScore = 0;
        const topPerformers = [];
        const needsImprovement = [];

        for (const lead of allLeadsQuery.rows) {
            const grading = gradeMessage(lead);
            totalScore += grading.score;
            gradeDistribution[grading.grade]++;

            // Track fact type distribution
            const factType = lead.research_fact_type || 'null';
            factTypeDistribution[factType] = (factTypeDistribution[factType] || 0) + 1;

            // Collect top performers (A- and above)
            if (grading.score >= 80) {
                topPerformers.push({
                    name: lead.person_name,
                    company: lead.company_name,
                    grade: grading.grade,
                    score: grading.score,
                    strengths: grading.strengths
                });
            }

            // Collect needs improvement (C or below)
            if (grading.score < 55) {
                needsImprovement.push({
                    name: lead.person_name,
                    company: lead.company_name,
                    grade: grading.grade,
                    score: grading.score,
                    issues: grading.issues
                });
            }
        }

        const avgScore = totalLeads > 0 ? (totalScore / totalLeads).toFixed(1) : 0;

        // === STEP 3: Generate Report ===
        console.log('═'.repeat(70));
        console.log('                    📊 MESSAGE QUALITY REPORT                    ');
        console.log('═'.repeat(70));
        console.log('');

        console.log('📈 OVERALL STATISTICS:');
        console.log(`   Total Leads Analyzed: ${totalLeads}`);
        console.log(`   Leads Missing Messages: ${missingCount} (flagged for MANUAL_REVIEW)`);
        console.log(`   Average Quality Score: ${avgScore}/100`);
        console.log('');

        console.log('📊 GRADE DISTRIBUTION:');
        Object.entries(gradeDistribution).forEach(([grade, count]) => {
            if (count > 0) {
                const percentage = ((count / totalLeads) * 100).toFixed(1);
                const bar = '█'.repeat(Math.floor(count / totalLeads * 50));
                console.log(`   ${grade.padEnd(3)} │ ${bar} ${count} (${percentage}%)`);
            }
        });
        console.log('');

        console.log('🎯 RESEARCH FACT TYPE DISTRIBUTION:');
        Object.entries(factTypeDistribution).forEach(([type, count]) => {
            if (count > 0) {
                const percentage = ((count / totalLeads) * 100).toFixed(1);
                const emoji = type === 'DEAL' ? '🏆' : type === 'SCALE' ? '📊' : type === 'THESIS' ? '💡' : type === 'MANUAL' ? '✍️' : '🔍';
                console.log(`   ${emoji} ${type.padEnd(10)} │ ${count} (${percentage}%)`);
            }
        });
        console.log('');

        if (topPerformers.length > 0) {
            console.log('🏆 TOP 5 PERFORMERS:');
            topPerformers
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .forEach((lead, idx) => {
                    console.log(`   ${idx + 1}. [${lead.grade}] ${lead.name} @ ${lead.company}`);
                    console.log(`      Score: ${lead.score}/100`);
                    console.log(`      Strengths: ${lead.strengths.slice(0, 2).join(', ')}`);
                });
            console.log('');
        }

        if (needsImprovement.length > 0) {
            console.log('⚠️  NEEDS IMPROVEMENT (Sample):');
            needsImprovement.slice(0, 5).forEach((lead, idx) => {
                console.log(`   ${idx + 1}. [${lead.grade}] ${lead.name} @ ${lead.company}`);
                console.log(`      Score: ${lead.score}/100`);
                console.log(`      Issues: ${lead.issues.slice(0, 2).join(', ')}`);
            });
            console.log('');
        }

        // === SELF GRADING ===
        console.log('═'.repeat(70));
        console.log('                      🎓 SELF ASSESSMENT                      ');
        console.log('═'.repeat(70));
        console.log('');

        let systemGrade = 'F';
        const aGradePercent = ((gradeDistribution['A+'] + gradeDistribution['A'] + gradeDistribution['A-']) / totalLeads) * 100;
        const dealFactPercent = (factTypeDistribution['DEAL'] / totalLeads) * 100;

        if (avgScore >= 85 && aGradePercent >= 60) systemGrade = 'A+';
        else if (avgScore >= 80 && aGradePercent >= 50) systemGrade = 'A';
        else if (avgScore >= 75 && aGradePercent >= 40) systemGrade = 'A-';
        else if (avgScore >= 70) systemGrade = 'B+';
        else if (avgScore >= 65) systemGrade = 'B';
        else if (avgScore >= 60) systemGrade = 'B-';
        else if (avgScore >= 55) systemGrade = 'C+';
        else if (avgScore >= 50) systemGrade = 'C';

        console.log(`   Overall System Grade: ${systemGrade}`);
        console.log(`   Average Message Score: ${avgScore}/100`);
        console.log(`   A-Grade Rate: ${aGradePercent.toFixed(1)}%`);
        console.log(`   Named Deal Fact Usage: ${dealFactPercent.toFixed(1)}%`);
        console.log('');

        console.log('📝 RECOMMENDATIONS:');
        if (avgScore < 70) {
            console.log('   ⚠️  System needs improvement in message quality');
        }
        if (missingCount > totalLeads * 0.1) {
            console.log(`   ⚠️  High rate of missing messages (${((missingCount / (totalLeads + missingCount)) * 100).toFixed(1)}%)`);
        }
        if (dealFactPercent < 20) {
            console.log('   💡 Increase usage of named deal facts for better specificity');
        }
        if (aGradePercent < 40) {
            console.log('   💡 Focus on improving personalization and fact quality');
        }
        if (aGradePercent >= 60 && avgScore >= 80) {
            console.log('   ✅ Strong performance! System generating high-quality messages');
        }

        console.log('');
        console.log('═'.repeat(70));
        console.log('');

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        await pool.end();
    }
}

auditAndGradeMessages();
