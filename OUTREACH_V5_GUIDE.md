# Outreach System V5 - Implementation Guide

## Overview

This document describes the complete implementation of Outreach System V5, which fixes the critical issues with bad leads being generated and ensures strict fact alignment in outreach messages.

## Key Improvements

### 1. **Bad Leads Are Reliably Skipped**
- Tier 2 (Residential Keywords) gating is now **MANDATORY**
- Tier 1 (Investor Keywords) gating is enforced per ICP type
- Tier 3 (Direct Investing Evidence) routes to NEEDS_RESEARCH instead of SKIP
- Disqualified ICP types (BROKERAGE, ADVISORY, CONSULTING, etc.) are auto-SKIPped

### 2. **SKIP Never Appears in Messages**
- Strict contract enforcement: If `outreach_status != 'SUCCESS'`, all message fields are `null`
- Database constraint prevents violating this rule
- No forced fallback messages are ever generated

### 3. **Qualified Leads With Insufficient Data Go to Manual Review**
- When profiles lack usable facts, status becomes `NEEDS_RESEARCH` (not SKIP)
- NEEDS_RESEARCH items populate the `outreach_manual_review_queue` table
- Manual review team can rescrape, add URLs, and regenerate

### 4. **Strict Fact Alignment**
- Research facts are extracted deterministically (no LLM guessing)
- Placeholders are detected and rejected
- Messages use templates that match fact type:
  - **DEAL**: "We frequently develop similar projects..."
  - **THESIS**: "We work on similar residential strategies..."
  - **SCALE**: "We are active in this scale of development..."
  - **GENERAL**: "We are active developers in this space..."

### 5. **Message Quality Assurance**
- Banned phrases are never in final output
- Message length must be < 300 characters
- If QA fails, status becomes `NEEDS_RESEARCH` (for retry after research)

## Database Schema Changes

### New Migrations

#### Migration 41: `outreach_status_tracking`
Adds outreach status fields to `leads` and `companies`:
- `outreach_status`: SUCCESS | SKIP | NEEDS_RESEARCH | ERROR
- `outreach_reason`: Human-readable reason
- `research_fact`: The extracted fact used in message
- `research_fact_type`: DEAL | THESIS | SCALE | GENERAL
- `message_version`: v5
- `profile_quality_score`: Confidence 0-1

**Constraint**: If status != SUCCESS, message fields (linkedin_message, email_subject, email_body) MUST be null

#### Migration 42: `create_manual_review_queue`
New table for items needing manual research:
- `outreach_manual_review_queue`: Tracks companies/leads needing deeper research
- Status: PENDING | IN_REVIEW | RESEARCHED | SKIPPED
- Includes suggested URLs and research suggestions
- Audit table for tracking all actions

## Code Changes

### New Files

#### 1. `src/backend/services/outreach/researchFactExtractor.js`
**Deterministic research fact extraction** - no LLM involved:
- Priority 1: Named deals/projects (proper nouns + property keywords)
- Priority 2: Thesis/strategy statements (focus on, invests in, etc.)
- Priority 3: Scale facts (unit counts, portfolio size)
- Priority 4: General focus fallback

**Placeholder detection** rejects:
- "123 Main Street", "Example Ave", "TBD", "Project X"
- All-caps/generic names
- Fake deal patterns

**Returns**:
```javascript
{
  fact: string | null,
  fact_type: "DEAL" | "THESIS" | "SCALE" | "GENERAL" | null,
  confidence: number (0-1),
  reason: string (why it was chosen or why null)
}
```

### Updated Files

#### 1. `src/backend/services/outreach-service.js`
**Complete rewrite** with strict contract:

**Gating Flow**:
1. Check disqualified ICP types → SKIP
2. Verify profile exists → SKIP if empty
3. Check Tier 2 (Residential) → SKIP if missing
4. Check Tier 1 (Investor) by ICP type:
   - InvestmentFirm: SKIP if missing
   - FamilyOffice: NEEDS_RESEARCH if missing
5. Check Tier 3 (Direct Evidence) → NEEDS_RESEARCH if missing
6. Extract research fact → NEEDS_RESEARCH if null
7. Generate message → SUCCESS or NEEDS_RESEARCH
8. QA check → NEEDS_RESEARCH if banned phrases/words

**Response Contract**:
```javascript
{
  outreach_status: "SUCCESS" | "SKIP" | "NEEDS_RESEARCH" | "ERROR",
  outreach_reason: string | null,
  research_fact: string | null,
  research_fact_type: string | null,
  message_version: "v5",
  profile_quality_score: number | null,
  linkedin_message: string | null,  // null unless status = SUCCESS
  email_subject: string | null,     // null unless status = SUCCESS
  email_body: string | null         // null unless status = SUCCESS
}
```

**Metrics Tracking**:
- `success_count`: Outreach successfully generated
- `skip_count`: Lead was rejected (bad fit)
- `needs_research_count`: Lead needs manual research
- `error_count`: Unexpected errors
- Skip/research reason breakdowns for debugging

## Integration Points

### 1. Database Integration
When OutreachService returns a result, persist as:
```sql
UPDATE leads SET
  outreach_status = result.outreach_status,
  outreach_reason = result.outreach_reason,
  research_fact = result.research_fact,
  research_fact_type = result.research_fact_type,
  message_version = result.message_version,
  profile_quality_score = result.profile_quality_score,
  linkedin_message = result.linkedin_message,
  email_subject = result.email_subject,
  email_body = result.email_body,
  outreach_generated_at = NOW()
WHERE id = lead_id;
```

### 2. Manual Review Queue Integration
When `outreach_status = 'NEEDS_RESEARCH'`, add to queue:
```sql
INSERT INTO outreach_manual_review_queue (
  company_id, company_name, website, fit_score, icp_type,
  outreach_reason, company_profile, entry_source
) VALUES (...)
```

Use provided function:
```sql
SELECT add_to_review_queue(
  p_company_id,
  p_company_name,
  p_website,
  p_fit_score,
  p_icp_type,
  p_outreach_reason,
  p_company_profile,
  'outreach_generation'
);
```

### 3. Server.js Endpoints to Update

#### Existing `/regenerate-outreach` endpoint
Update to use new OutreachService and handle all response statuses:

```javascript
const result = await OutreachService.createLeadMessages({
  company_name: company.company_name,
  website: company.website,
  company_profile: company.company_profile,
  fit_score: company.fit_score,
  icp_type: company.icp_type,
  first_name: lead.first_name
});

// Persist result
await updateLeadOutreach(lead_id, result);

// If NEEDS_RESEARCH, add to queue
if (result.outreach_status === 'NEEDS_RESEARCH') {
  await addToReviewQueue(company_id, company, result.outreach_reason);
}
```

## Testing

### Run Acceptance Tests
```bash
node test/outreach-v5-acceptance-tests.js
```

Tests verify:
- ✅ Bad leads are SKIPped
- ✅ SKIP text never in messages
- ✅ Tier gating works correctly
- ✅ Research facts are extracted properly
- ✅ Placeholders are rejected
- ✅ Message length < 300 chars
- ✅ Banned phrases/words never appear
- ✅ Templates align with fact type
- ✅ Contract enforcement (null messages for non-SUCCESS)
- ✅ Metrics are collected

### Manual Testing
Test with specific profiles:
```javascript
import { OutreachService } from './src/backend/services/outreach-service.js';

const result = await OutreachService.createLeadMessages({
  company_name: 'Test Company',
  company_profile: 'Residential investor focus on multifamily...',
  icp_type: 'InvestmentFirm',
  first_name: 'John'
});

console.log(result);
```

## Metrics & Observability

### Track These Metrics
- **Daily outreach_success_count**: Successfully generated
- **Daily outreach_skip_count**: Rejected
- **Daily outreach_needs_research_count**: Needs manual work
- **Top 10 skip_reasons**: Why we're rejecting
- **Top 10 needs_research_reasons**: Why manual review needed
- **Avg profile_quality_score**: Fact extraction confidence
- **% of SUCCESS vs SKIP vs NEEDS_RESEARCH**: Overall health

### Access Metrics
```javascript
const metrics = OutreachService.getMetrics();
console.log(metrics);
// {
//   success_count: 45,
//   skip_count: 12,
//   needs_research_count: 8,
//   error_count: 2,
//   skip_reasons: { tier_2_missing: 8, icp_type_disqualified: 4 },
//   needs_research_reasons: { tier_3_missing: 5, ... },
//   total_generated: 67
// }
```

## Keyword Lists (Gating)

### Tier 1: Investor Intent (Required for InvestmentFirm)
```javascript
'invests', 'investment', 'acquires', 'acquisition', 'fund', 'strategy',
'co invest', 'co-invest', 'joint venture', 'portfolio', 'asset management',
'private equity', 'real estate equity', 'lp', 'gp', 'partner capital',
'investing', 'capital deployment', 'deploy capital'
```

### Tier 2: Residential Relevance (MANDATORY for all)
```javascript
'residential', 'multifamily', 'multi-family', 'multi family', 'multi-suite',
'apartment', 'apartments', 'purpose built rental', 'purpose-built rental',
'rental housing', 'housing', 'condo', 'condominium', 'condo development',
'student housing', 'senior living', 'sfr', 'single family rental',
'apartment community', 'residential community', 'residential development'
```

### Tier 3: Direct Investing Evidence (Routes to NEEDS_RESEARCH if missing)
```javascript
'acquired', 'portfolio', 'we invest', 'capital deployed', 'deal', 'deals',
'co-invest', 'direct investments', 'investment platform', 'holdings',
'assets under management', 'aum', 'transaction', 'transactions',
'deployment', 'invest in', 'invested in'
```

### Banned Output Phrases (QA Check)
```javascript
'global reach', 'years in business', 'impressed', 'congrats', 'synergies',
'quick call', 'hop on a call', 'schedule a call', 'in your role as', 'as ceo'
```

### Banned Output Words
```javascript
'aum', 'offices', 'international', 'award'
```

## Manual Review Queue Workflow

### 1. Item Enters Queue
When OutreachService returns NEEDS_RESEARCH:
- Company added to `outreach_manual_review_queue`
- Status = PENDING
- Includes company profile excerpt and research suggestions

### 2. Team Reviews
- Visit UI panel: "Outreach Manual Review"
- Filter by reason, ICP type, fit score
- Read profile excerpt
- Decide: rescrape or skip

### 3. Rescrape & Regenerate
- Click "Enrich Profile" → calls ResearchService with deeper scraping
- Adds 10+ pages, portfolio pages, news pages
- Updates company_profile in DB
- Click "Regenerate Outreach" → calls OutreachService again
- New message generated if facts now available

### 4. Mark Complete
- Sets status = RESEARCHED
- Updates company_profile with new data
- Audit trail recorded

## Rollout Checklist

- [ ] Run migrations 41 and 42
- [ ] Deploy new OutreachService and ResearchFactExtractor
- [ ] Update server.js integration points
- [ ] Run acceptance tests
- [ ] Monitor metrics (especially NEEDS_RESEARCH queue size)
- [ ] Set up manual review UI/endpoints
- [ ] Train team on manual review process
- [ ] Monitor for regressions

## Support & Debugging

### Common Issues

**Q: Too many NEEDS_RESEARCH items in queue?**
- Profile text is too generic or missing specifics
- Implement deeper scraping in ResearchService
- Check if profile extraction is working (company_profile field)

**Q: SKIP count very high?**
- Check if target companies match Tier 2 keywords
- Review tier keyword lists for accuracy
- May indicate poor lead source quality

**Q: Message generation timeouts?**
- Check Gemini API limits (if still used)
- Fact extraction should be fast (no API calls)
- Current design doesn't call Gemini for message generation

**Q: Banned phrases appearing?**
- QA filter may have regex issues
- Check exact string matching in _performQA
- Review BANNED_OUTPUT_PHRASES list

## Future Enhancements

1. **Deeper research**: Integrate with web scraper for URLs in NEEDS_RESEARCH queue
2. **A/B testing**: Compare different openers/closers by response rate
3. **Enrichment**: Auto-enrich profiles when Tier 3 missing
4. **Learning**: Track which fact types generate highest response rates
5. **API**: Expose OutreachService as REST endpoint for external tools

---

**Version**: V5  
**Date**: 2026-01-22  
**Status**: Implementing
