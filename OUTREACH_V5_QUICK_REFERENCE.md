# Outreach V5 - Quick Reference Card

## Core Response Contract

```javascript
{
  outreach_status: "SUCCESS" | "SKIP" | "NEEDS_RESEARCH" | "ERROR",
  outreach_reason: string | null,
  research_fact: string | null,
  research_fact_type: "DEAL" | "THESIS" | "SCALE" | "GENERAL" | null,
  message_version: "v5",
  profile_quality_score: number (0-1) | null,
  linkedin_message: string | null,  // ⚠️ null unless SUCCESS
  email_subject: string | null,     // ⚠️ null unless SUCCESS
  email_body: string | null         // ⚠️ null unless SUCCESS
}
```

**CRITICAL RULE**: If `outreach_status != "SUCCESS"`, all message fields MUST be null.

---

## Gating Flow (Decision Tree)

```
Start: createLeadMessages(company_profile, icp_type)
│
├─ Is ICP type disqualified?
│  └─ (BROKERAGE, ADVISORY, CONSULTING, AGENCY, SERVICE, TECH, VENDOR, PROPERTY_MANAGEMENT)
│     └─ SKIP ❌
│
├─ Profile empty?
│  └─ SKIP ❌
│
├─ Has Tier 2 (Residential keywords)?
│  └─ NO → SKIP ❌
│  └─ YES → Continue
│
├─ Has Tier 1 (Investor keywords)?
│  └─ NO:
│     └─ Is FamilyOffice? → NEEDS_RESEARCH 🔍
│     └─ Else (InvestmentFirm) → SKIP ❌
│  └─ YES → Continue
│
├─ Has Tier 3 (Direct Evidence)?
│  └─ NO → NEEDS_RESEARCH 🔍
│  └─ YES → Continue
│
├─ Extract research fact (deterministic)
│  └─ Null result? → NEEDS_RESEARCH 🔍
│  └─ Got fact? → Continue
│
├─ Generate message from fact
│  └─ Message > 300 chars? → NEEDS_RESEARCH 🔍
│  └─ OK → Continue
│
├─ QA check (banned phrases/words)
│  └─ Fail? → NEEDS_RESEARCH 🔍
│  └─ Pass? → Continue
│
└─ SUCCESS ✅
   (linkedin_message, email_subject, email_body populated)
```

---

## Tier Keywords Quick Lookup

### Tier 1: Investor Intent (Required for InvestmentFirm, optional for FamilyOffice)
**Key words**: invest, fund, strategy, portfolio, capital, private equity, acquisitions

### Tier 2: Residential (MANDATORY for all)
**Key words**: residential, multifamily, apartment, condo, rental, housing

### Tier 3: Direct Evidence (Missing routes to NEEDS_RESEARCH)
**Key words**: acquired, portfolio, capital deployed, deal, transactions, AUM

---

## Message Templates by Fact Type

### DEAL
```
Hi {First_name}, {opener} {deal_name}. We frequently develop similar 
projects at Fifth Avenue Properties and often partner with groups deploying 
long-term capital. {closer}.
```

### THESIS
```
Hi {First_name}, {opener} {strategy/focus}. We work on similar residential 
strategies at Fifth Avenue Properties and often partner with groups deploying 
long-term capital. {closer}.
```

### SCALE
```
Hi {First_name}, {opener} {unit_count}. We are active in this scale of 
residential development at Fifth Avenue Properties and often partner with 
groups deploying long-term capital. {closer}.
```

### GENERAL
```
Hi {First_name}, {opener} {company_name}'s focus on the residential sector. 
We are active developers in this space at Fifth Avenue Properties and thought 
connecting could be worthwhile.
```

---

## Placeholder Detection Examples (REJECTED)

❌ "123 Main Street"  
❌ "Example Avenue"  
❌ "Project X"  
❌ "TBD"  
❌ "[Deal Name]"  

✅ "Alpine Village Towers"  
✅ "The Residences at Park Avenue"  
✅ "Riverside Commons"  

---

## Banned Output Phrases & Words

### PHRASES (exact match, case-insensitive)
```
global reach
years in business
quick call
hop on a call
schedule a call
in your role as
as ceo
```

### WORDS (anywhere in output)
```
aum
offices
international
award
impressed
congrats
synergies
```

---

## Database Integration (Pseudo-code)

```javascript
const result = await OutreachService.createLeadMessages({
  company_name,
  company_profile,
  fit_score,
  icp_type,
  first_name
});

// Step 1: Persist result
await db.query(`
  UPDATE leads SET
    outreach_status = $1,
    outreach_reason = $2,
    research_fact = $3,
    research_fact_type = $4,
    linkedin_message = $5,
    email_subject = $6,
    email_body = $7,
    profile_quality_score = $8,
    outreach_generated_at = NOW()
  WHERE id = $9
`, [
  result.outreach_status,
  result.outreach_reason,
  result.research_fact,
  result.research_fact_type,
  result.linkedin_message,
  result.email_subject,
  result.email_body,
  result.profile_quality_score,
  lead_id
]);

// Step 2: If NEEDS_RESEARCH, add to queue
if (result.outreach_status === 'NEEDS_RESEARCH') {
  await db.query(`
    SELECT add_to_review_queue($1, $2, $3, $4, $5, $6, $7, 'outreach_generation')
  `, [
    company_id,
    company_name,
    website,
    fit_score,
    icp_type,
    result.outreach_reason,
    company_profile
  ]);
}
```

---

## Metrics Endpoint

```javascript
const metrics = OutreachService.getMetrics();

// Returns:
{
  success_count: 45,
  skip_count: 12,
  needs_research_count: 8,
  error_count: 2,
  total_generated: 67,
  skip_reasons: {
    tier_2_missing: 6,
    icp_type_disqualified: 4,
    tier_1_missing: 2
  },
  needs_research_reasons: {
    tier_3_missing: 5,
    no_usable_fact: 3
  }
}
```

---

## Debugging Checklist

**Problem: Too many SKIP results?**
- Check if leads have residential keywords (Tier 2)
- Verify icp_type is correct
- Check for disqualified types

**Problem: Too many NEEDS_RESEARCH results?**
- Profile may be too generic
- Missing Tier 3 keywords (deal evidence)
- Fact extraction may be finding nothing
- Check manual_review_queue size

**Problem: Banned phrase appearing in message?**
- Profile likely contains the banned phrase
- Check QA filter is running
- Verify banned phrases list is complete

**Problem: Message generation timeout?**
- Fact extraction should be fast (no API calls)
- Check ResearchFactExtractor performance
- Profile may be very large (check size)

---

## Testing Commands

```bash
# Run acceptance tests
node test/outreach-v5-acceptance-tests.js

# Test single company
node -e "
import { OutreachService } from './src/backend/services/outreach-service.js';
const r = await OutreachService.createLeadMessages({
  company_name: 'Test',
  company_profile: 'multifamily residential investor...',
  icp_type: 'InvestmentFirm'
});
console.log(JSON.stringify(r, null, 2));
"

# Get metrics
node -e "
import { OutreachService } from './src/backend/services/outreach-service.js';
console.log(JSON.stringify(OutreachService.getMetrics(), null, 2));
"
```

---

## Files Modified/Created

| File | Type | Purpose |
|------|------|---------|
| `db/migrations/41_add_outreach_status_tracking.sql` | Migration | Status field tracking |
| `db/migrations/42_create_manual_review_queue.sql` | Migration | Manual review queue |
| `src/backend/services/outreach-service.js` | Service | Main generation logic (V5) |
| `src/backend/services/outreach/researchFactExtractor.js` | Service | Deterministic fact extraction |
| `test/outreach-v5-acceptance-tests.js` | Test | Acceptance criteria validation |
| `OUTREACH_V5_GUIDE.md` | Doc | Full implementation guide |
| `OUTREACH_V5_IMPLEMENTATION.md` | Doc | Summary & rollout checklist |

---

## Key Improvements Over V4

| Aspect | V4 | V5 |
|--------|----|----|
| **Bad Lead Filtering** | Disabled | Strict Tier gating |
| **SKIP in Messages** | Possible | Impossible (contract enforced) |
| **Fact Selection** | LLM decides | Deterministic code |
| **Placeholders** | Not detected | Actively rejected |
| **Manual Review** | Not implemented | Full NEEDS_RESEARCH workflow |
| **Message Alignment** | Generic | Fact-type specific templates |
| **Quality Assurance** | Basic | QA with banned phrases/words |
| **Metrics** | None | Comprehensive tracking |

---

**Quick Start**: Run migrations → Deploy code → Update server.js → Test → Monitor

