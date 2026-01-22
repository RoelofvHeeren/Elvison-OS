# Family Office Workflow - Developer Reference

## Quick API Reference

### FO Firewall (Deterministic Heuristics)

```javascript
import { runFamilyOfficeFirewall } from './src/backend/services/fo-firewall.js';

// Free check - no LLM calls
const result = runFamilyOfficeFirewall(
    companyName,      // String
    profileText,      // String (company description)
    domain            // String (domain)
);

// Returns:
{
    decision: 'PASS' | 'REJECT' | 'UNCERTAIN',
    entity_type: 'FAMILY_OFFICE' | 'WEALTH_MANAGER' | 'INVESTMENT_FUND' | 'UNKNOWN',
    confidence: 0.0-1.0,
    reason: "Why this decision",
    cost: 'free'  // Always free
}
```

**When to use:** Pre-filter before expensive LLM calls

### Entity Classifier (AI-Powered)

```javascript
import { classifyEntity, scoreFOMatch, classifyAndScoreFO } from './src/backend/services/entity-classifier.js';

// Step A: Just entity classification
const classification = await classifyEntity(companyName, profileText, domain);
// Returns: { entity_type, entity_subtype, confidence, signals_positive, signals_negative, reason }

// Step B: Just FO score
const score = await scoreFOMatch(companyName, profileText, geography, isSFO);
// Returns: { match_score, confidence, fit_reasons, geo_match, asset_focus, recommendation }

// Combined: Full 2-stage qualification
const result = await classifyAndScoreFO(companyName, profileText, domain, geography);
// Returns: { classification, score, recommendation, fo_status, combined_confidence }
```

**Costs:**
- Firewall: $0 (heuristics)
- Step A: ~$0.01-0.02 (Gemini API)
- Step B: ~$0.01-0.02 (Gemini API)
- Combined: ~$0.02-0.04 with smart firewall

### Query Bank

```javascript
import { 
    generateFOQuerySet,
    buildFamilyOfficeQuery,
    FAMILY_OFFICE_QUERY_PATTERNS
} from './src/backend/icps/familyOffice.queryBank.js';

// Get ready-to-use queries for geography
const queries = generateFOQuerySet('Canada');
// Returns: array of 8+ complete Google search queries

// Build custom query
const customQuery = buildFamilyOfficeQuery(
    '"private investment office"',
    'Toronto Canada',
    ['-lawyer', '-law firm']  // Optional exclusions
);
// Returns: '"private investment office" Toronto Canada -advisor -wealth -RIA -lawyer -law firm'

// Browse available patterns
console.log(FAMILY_OFFICE_QUERY_PATTERNS.sleeper);  // Best-performing terms
console.log(FAMILY_OFFICE_QUERY_PATTERNS.directFO); // Standard terms
console.log(FAMILY_OFFICE_QUERY_PATTERNS.holdings); // Holding company patterns
```

### FO Run Reporter

```javascript
import FORunReporter from './src/backend/services/fo-run-reporter.js';

const reporter = new FORunReporter();

// Record each step
reporter.recordHeuristicCheck(firewallResult);
reporter.recordEntityClassification(companyName, classificationResult);
reporter.recordFinalStatus(companyName, 'APPROVED', matchScore, confidence);
reporter.recordError(companyName, error);
reporter.recordCost(geminiCostUsd);

// Generate reports
const jsonReport = reporter.toJSON();
const markdownReport = reporter.toMarkdown();
const finalStats = reporter.finalize();
```

## Database Schema Quick Reference

### New ICP Column
```sql
SELECT id, name, icp_category FROM icps;
-- icp_category: FAMILY_OFFICE | INVESTMENT_FUND | OPERATOR | REIT | OTHER
```

### New Company Columns
```sql
SELECT 
    company_name,
    entity_type,        -- FAMILY_OFFICE, WEALTH_MANAGER, INVESTMENT_FUND, OPERATOR, REIT, UNKNOWN
    entity_subtype,     -- SFO, MFO, FAMILY_CAPITAL, RIA, PRIVATE_EQUITY, PENSION, SOVEREIGN, UNKNOWN
    entity_confidence,  -- 0.0-1.0
    entity_reason,      -- Text explanation
    fo_status,          -- APPROVED, REVIEW, REJECTED, UNKNOWN
    icp_id              -- FK to icps(id)
FROM companies;
```

### New Lead Columns
```sql
SELECT 
    id,
    company_name,
    entity_type,
    entity_subtype,
    entity_confidence,
    entity_reason,
    fo_status,
    icp_id
FROM leads;
```

## Common Workflows

### Workflow: Discover and Qualify FOs (Full Pipeline)

```javascript
import { generateFOQuerySet } from './familyOffice.queryBank.js';
import { classifyAndScoreFO } from './entity-classifier.js';
import FORunReporter from './fo-run-reporter.js';

async function discoverFO(icpConfig) {
    const reporter = new FORunReporter();
    
    // 1. Generate search queries
    const queries = generateFOQuerySet(icpConfig.geography);
    
    // 2. Run searches, get companies (via Apollo, Google, etc)
    const discoveredCompanies = await runSearchQueries(queries);
    
    // 3. Qualify each one
    for (const company of discoveredCompanies) {
        try {
            const result = await classifyAndScoreFO(
                company.name,
                company.description,
                company.domain,
                icpConfig.geography
            );
            
            // Record metrics
            reporter.recordEntityClassification(company.name, result.classification);
            reporter.recordFinalStatus(company.name, result.fo_status, result.score.match_score, result.combined_confidence);
            reporter.recordCost(0.03); // Estimate
            
            // Save to DB
            await saveCompany({
                company_name: company.name,
                entity_type: result.classification.entity_type,
                entity_confidence: result.classification.confidence,
                fo_status: result.fo_status,
                fit_score: result.score.match_score,
                company_profile: company.description
            });
            
        } catch (err) {
            reporter.recordError(company.name, err);
        }
    }
    
    // 4. Generate report
    return reporter.finalize();
}
```

### Workflow: Filter for Apollo Feed (Approved FOs Only)

```javascript
// In workflow before sending to Apollo
const icpId = req.body.icpId;
const foIcp = await query(`SELECT icp_category FROM icps WHERE id = $1`, [icpId]);

if (foIcp.rows[0]?.icp_category === 'FAMILY_OFFICE') {
    // Only approved FOs
    const approvedLeads = await query(`
        SELECT * FROM leads
        WHERE icp_id = $1
        AND fo_status IN ('APPROVED', 'REVIEW')  // Depending on your tolerance
        AND entity_type IN ('FAMILY_OFFICE', 'UNKNOWN')
        AND status != 'DISQUALIFIED'
    `, [icpId]);
    
    // Send only these to Apollo
    return approvedLeads;
}
```

### Workflow: Export FO Report (Type-Safe)

```javascript
// In GET /api/companies/export
const icpId = req.query.icpId;
const foIcp = await query(`SELECT icp_category FROM icps WHERE id = $1`, [icpId]);

if (foIcp.rows[0]?.icp_category === 'FAMILY_OFFICE') {
    // Use entity_type instead of icp_type
    const companies = await query(`
        SELECT * FROM companies
        WHERE icp_id = $1
        AND (
            entity_type = 'FAMILY_OFFICE'
            OR (entity_type = 'UNKNOWN' AND fo_status IN ('APPROVED', 'REVIEW'))
        )
        AND fo_status != 'REJECTED'
        ORDER BY entity_confidence DESC
    `, [icpId]);
    
    // Generate CSV
    return generateCSV(companies);
}
```

### Workflow: Audit and Reclassify (Non-Destructive)

```bash
# Dry run to preview changes
node audit_family_offices.js --dry-run

# Execute reclassifications
node audit_family_offices.js --execute

# Result: Companies reclassified to correct ICP, no data deleted
```

## Configuration Examples

### Basic FO ICP Setup

```javascript
const icpConfig = {
    name: 'Canadian Family Offices',
    icp_category: 'FAMILY_OFFICE',
    config: {
        geography: 'Canada',
        use_firewall: true,
        firewall_confidence_threshold: 0.7,
        allow_review_to_apollo: false,
        deep_research_required: true,
        confidence_threshold_approve: 0.7,
        confidence_threshold_review: 0.5
    }
};
```

### Custom Query Bank Extension

```javascript
// Add to FAMILY_OFFICE_QUERY_PATTERNS in familyOffice.queryBank.js
export const CUSTOM_FO_PATTERNS = {
    toronto: [
        '"family office" Toronto real estate',
        '"private investment office" GTA',
        'holding company Toronto residential'
    ],
    sector_focus: {
        residential: [
            '"family office" multifamily residential',
            '"private capital" apartment development'
        ],
        industrial: [
            'family office industrial real estate',
            '"private investment" logistics'
        ]
    }
};
```

## Troubleshooting Common Issues

### Issue: "Too many wealth managers in FO list"

**Cause:** Firewall threshold too low or heuristics not catching them

**Fix:**
```javascript
// In entity-classifier.js, increase sensitivity
if (wmCheck.is_wealth_manager && wmCheck.confidence > 0.5) {
    // Make more strict
    // Change to > 0.4 to catch more
}

// Or add more heuristics in fo-firewall.js
WEALTH_MANAGER_HEURISTICS.push(
    /your\s+custom\s+pattern/i
);
```

### Issue: "Not finding enough family offices"

**Cause:** Queries too specific or geographic scope wrong

**Fix:**
```javascript
// Test individual query
const queries = generateFOQuerySet('Canada');
console.log(queries); // Review each one

// Make less restrictive
const customQuery = buildFamilyOfficeQuery(
    'holding company real estate',
    'Canada',
    [] // Remove exclusions temporarily
);
```

### Issue: "Entity classification always returns UNKNOWN"

**Cause:** Profile text too sparse or API key issue

**Fix:**
```javascript
// Ensure company profile has content
const profile = await deepResearch(company.domain);
// Then retry classification

// Or check API key
console.log(process.env.GOOGLE_API_KEY?.substring(0, 10));
```

### Issue: "fo_status stays NULL after updates"

**Cause:** Not setting fo_status during classification

**Fix:**
```javascript
// Ensure fo_status is set explicitly
await query(`
    UPDATE companies
    SET fo_status = $1
    WHERE company_name = $2
`, ['APPROVED', companyName]);
```

## Performance Tips

### 1. Use Firewall First

```javascript
// ❌ SLOW: Always call LLM
const classification = await classifyEntity(name, profile, domain);

// ✅ FAST: Firewall first, LLM only if needed
const firewall = runFamilyOfficeFirewall(name, profile, domain);
if (firewall.decision !== 'UNCERTAIN') {
    return firewall; // ~3ms, free
}
const classification = await classifyEntity(name, profile, domain); // ~500ms, costs $
```

### 2. Batch Scoring

```javascript
// ❌ SLOW: One at a time
for (const company of companies) {
    await classifyAndScoreFO(company...);
    await new Promise(r => setTimeout(r, 500)); // Rate limit
}

// ✅ FAST: Batch up to API limits
const scoredBatch = await Promise.all(
    companies.slice(0, 10).map(c => 
        classifyAndScoreFO(c.name, c.profile, c.domain, geo)
    )
);
```

### 3. Cache Classifications

```javascript
// Don't re-classify if already done
const existing = await query(`
    SELECT entity_type, fo_status 
    FROM companies 
    WHERE company_name = $1 AND entity_type != 'UNKNOWN'
`, [companyName]);

if (existing.rows.length > 0) {
    return existing.rows[0]; // Use cached
}

// Only if never classified
const result = await classifyAndScoreFO(...);
```

### 4. Use Indexes

```sql
-- Ensure fast lookups
CREATE INDEX idx_companies_entity_type ON companies(entity_type);
CREATE INDEX idx_companies_fo_status ON companies(fo_status);
CREATE INDEX idx_companies_icp_id ON companies(icp_id);
CREATE INDEX idx_icps_category ON icps(icp_category);
```

## Testing Utilities

### Test Firewall Accuracy

```javascript
const testCases = [
    {
        name: 'Smith Wealth Management',
        profile: 'We provide wealth management services',
        domain: 'smith-wealth.com',
        expected: 'WEALTH_MANAGER'
    },
    {
        name: 'Claridge Inc',
        profile: 'Single family office focused on real estate',
        domain: 'claridge.ca',
        expected: 'FAMILY_OFFICE'
    }
];

for (const test of testCases) {
    const result = runFamilyOfficeFirewall(test.name, test.profile, test.domain);
    console.assert(
        result.entity_type === test.expected,
        `${test.name}: expected ${test.expected}, got ${result.entity_type}`
    );
}
```

### Validate Query Bank

```javascript
const queries = generateFOQuerySet('Canada');

// Check quality
console.assert(queries.length > 5, 'Should have multiple queries');
console.assert(
    queries.some(q => q.includes('private investment')),
    'Should include sleeper terms'
);
console.assert(
    queries.every(q => q.includes('-advisor')),
    'All queries should exclude advisors'
);

// Check diversity
const uniqueTerms = new Set(queries.flatMap(q => q.split('"')));
console.assert(uniqueTerms.size > 15, 'Should have variety');
```

## File Map

```
src/backend/
├── services/
│   ├── fo-firewall.js                 # Heuristic checks (FREE)
│   ├── entity-classifier.js           # AI classification (LLM)
│   ├── fo-run-reporter.js             # Metrics & reporting
│   └── company-scorer.js              # FIXED: FO preservation
├── icps/
│   └── familyOffice.queryBank.js      # FO-specific search queries
└── ... (other services)

db/
└── migrations/
    └── 40_add_fo_type_safety.sql      # Schema updates

audit_family_offices.js                # UPDATED: Non-destructive reclassification
server.js                              # FIXED: Export filtering by icp_category
```

---

**Last Updated:** 2026-01-22  
**Version:** 1.0
