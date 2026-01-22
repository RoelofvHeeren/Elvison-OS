# Family Office Workflow Upgrade - Quick Start Checklist

## Phase 0: Pre-Implementation (Do These First)

- [ ] Back up production database
- [ ] Review [FO_WORKFLOW_UPGRADE.md](FO_WORKFLOW_UPGRADE.md) completely
- [ ] Test migration in staging: `node db/init.js` then run migration 40

## Phase 1: Database Migration

```bash
# Run the migration
psql $DATABASE_URL -f db/migrations/40_add_fo_type_safety.sql

# Verify new columns exist
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='icps' AND column_name='icp_category';"
```

- [ ] Migration 40 runs without errors
- [ ] New columns visible in all three tables (icps, companies, leads)
- [ ] Existing data preserved (no records deleted)

## Phase 2: Verify New Services Load

```bash
# Test imports
node -e "import('./src/backend/services/fo-firewall.js').then(() => console.log('✅ fo-firewall loaded'))"
node -e "import('./src/backend/services/entity-classifier.js').then(() => console.log('✅ entity-classifier loaded'))"
node -e "import('./src/backend/icps/familyOffice.queryBank.js').then(() => console.log('✅ query bank loaded'))"
node -e "import('./src/backend/services/fo-run-reporter.js').then(() => console.log('✅ reporter loaded'))"
```

- [ ] All four new services import without errors
- [ ] No missing dependencies or syntax errors

## Phase 3: Configure Existing ICPs

```sql
-- Set icp_category for all existing ICPs
UPDATE icps SET icp_category = 'FAMILY_OFFICE' WHERE name ILIKE '%Family%' AND icp_category = 'OTHER';
UPDATE icps SET icp_category = 'INVESTMENT_FUND' WHERE name ILIKE '%Fund%' AND icp_category = 'OTHER';

-- Verify
SELECT id, name, icp_category FROM icps WHERE icp_category IS NOT NULL;
```

- [ ] All ICPs have icp_category set
- [ ] No icps with icp_category = NULL (except by design)

## Phase 4: Backfill Entity Classifications

```sql
-- For existing FO companies, mark as FAMILY_OFFICE
UPDATE companies 
SET entity_type = 'FAMILY_OFFICE', 
    entity_confidence = 0.8,
    fo_status = 'APPROVED'
WHERE icp_type IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI');

-- For obvious wealth managers, mark as such
UPDATE companies 
SET entity_type = 'WEALTH_MANAGER',
    entity_confidence = 0.9,
    fo_status = 'REJECTED'
WHERE company_name ILIKE '%wealth%' OR company_name ILIKE '%advisor%';

-- Verify
SELECT COUNT(*), entity_type, fo_status FROM companies GROUP BY entity_type, fo_status;
```

- [ ] FO companies updated with entity_type
- [ ] Wealth managers reclassified
- [ ] Non-FO investment firms have entity_type = INVESTMENT_FUND or UNKNOWN

## Phase 5: Test Firewall

```javascript
// src/backend/services/fo-firewall.test.js
import { runFamilyOfficeFirewall } from './fo-firewall.js';

// Should REJECT as wealth manager
const wm = runFamilyOfficeFirewall('Smith Wealth Mgmt', 'We provide wealth management services', 'smith-wealth.com');
console.assert(wm.decision === 'REJECT' && wm.entity_type === 'WEALTH_MANAGER', 'Wealth manager should reject');

// Should PASS as FO
const fo = runFamilyOfficeFirewall('Claridge Inc', 'Single family office focused on real estate investments', 'claridge.ca');
console.assert(fo.decision === 'PASS' || fo.decision === 'UNCERTAIN', 'FO should not immediately reject');

// Should REJECT as fund
const fund = runFamilyOfficeFirewall('Ontario Teachers', 'Manages pension assets', 'otpp.com');
console.assert(fund.decision === 'REJECT' && fund.entity_type === 'INVESTMENT_FUND', 'Fund should reject');

console.log('✅ Firewall tests pass');
```

- [ ] Firewall correctly rejects wealth managers
- [ ] Firewall allows FO-like entities to pass
- [ ] Firewall correctly identifies investment funds

## Phase 6: Test Entity Classifier

```javascript
// src/backend/services/entity-classifier.test.js
import { classifyEntity } from './entity-classifier.js';

const result = await classifyEntity('Claridge Inc', 'private family office...', 'claridge.ca');
console.assert(result.entity_type === 'FAMILY_OFFICE' || result.source === 'firewall_heuristic', 'Should classify as FO');
console.log('✅ Entity classifier test pass');
```

- [ ] Classifier returns valid JSON
- [ ] Classification has entity_type, confidence, reasoning
- [ ] Firewall heuristics run first (cost saving)

## Phase 7: Test Query Bank

```javascript
// src/backend/icps/familyOffice.queryBank.test.js
import { generateFOQuerySet } from './familyOffice.queryBank.js';

const queries = generateFOQuerySet('Canada');
console.assert(queries.length > 5, 'Should generate multiple queries');
console.assert(queries.some(q => q.includes('private investment office')), 'Should include sleeper terms');
console.assert(queries.every(q => q.includes('-advisor') || q.includes('-wealth')), 'Should exclude non-FO terms');
console.log('✅ Query bank test pass');
```

- [ ] Query bank generates 8+ queries
- [ ] Queries include "private investment office" and similar high-value terms
- [ ] All queries include wealth manager exclusions

## Phase 8: Test Reporter

```javascript
// src/backend/services/fo-run-reporter.test.js
import FORunReporter from './fo-run-reporter.js';

const reporter = new FORunReporter();
reporter.recordHeuristicCheck({ decision: 'REJECT', entity_type: 'WEALTH_MANAGER' });
reporter.recordFinalStatus('Test Co', 'APPROVED', 7.5, 0.85);
const report = reporter.finalize();

console.assert(report.summary.heuristic_analysis.rejected_wealth_managers === 1, 'Should track rejections');
console.assert(report.summary.qualification_results.approved === 1, 'Should track approvals');
console.log('✅ Reporter test pass');
```

- [ ] Reporter generates valid report object
- [ ] Metrics calculate correctly
- [ ] toMarkdown() produces readable output

## Phase 9: Fix server.js Verified

```bash
# Check that export endpoint uses icp_category instead of name matching
grep -n "icp_category" server.js | head -5
```

- [ ] server.js line ~2331 uses icp_category instead of icp_name.includes()
- [ ] Export filtering checks entity_type and fo_status
- [ ] No more name-based matching for FOs

## Phase 10: Test Export Endpoint

```bash
# After creating a test FO ICP:
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3001/api/companies/export?icpId=<fo_icp_id>'
```

- [ ] Export returns only FO entities (entity_type = FAMILY_OFFICE)
- [ ] Export respects fo_status filter (no REJECTED)
- [ ] No wealth managers in export

## Phase 11: Run Audit Script

```bash
# Dry run first
node audit_family_offices.js --dry-run

# Review output
# Expected: Some keep, some reclassify, no disqualifications

# Execute if looks good
node audit_family_offices.js --execute
```

- [ ] Audit runs without errors
- [ ] Generates meaningful classifications
- [ ] Reclassifies misclassified entities (non-destructive)
- [ ] No "DISQUALIFIED" status used

## Phase 12: Integration Test - Full Workflow

```bash
# 1. Verify FO ICP exists with icp_category set
psql $DATABASE_URL -c "SELECT id, name, icp_category FROM icps WHERE icp_category = 'FAMILY_OFFICE' LIMIT 1;"

# 2. Add a test company
psql $DATABASE_URL -c "INSERT INTO companies (user_id, company_name, entity_type, entity_confidence, fo_status) VALUES ('$USER_ID', 'Test FO Inc', 'FAMILY_OFFICE', 0.8, 'APPROVED');"

# 3. Create a test lead
psql $DATABASE_URL -c "INSERT INTO leads (user_id, company_name, person_name, email, icp_id, entity_type, fo_status) VALUES ('$USER_ID', 'Test FO Inc', 'John Doe', 'john@testfo.com', '$FO_ICP_ID', 'FAMILY_OFFICE', 'APPROVED');"

# 4. Test API export with FO filter
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3001/api/companies/export?icpId=<fo_icp_id>'

# 5. Verify no wealth managers in result
# Should only see companies with entity_type = FAMILY_OFFICE or UNKNOWN (with fo_status != REJECTED)
```

- [ ] Full workflow chain works end-to-end
- [ ] FO companies filter correctly
- [ ] No wealth managers leak through
- [ ] API returns valid CSV

## Phase 13: Smoke Tests - Production Equivalent

```bash
# Test critical endpoints with real data:

# 1. Get companies with FO filter
curl "http://localhost:3001/api/companies?icpId=$FO_ICP_ID"

# 2. Export FO leads
curl "http://localhost:3001/api/leads/export?icpId=$FO_ICP_ID"

# 3. Check no ASSET_MANAGER_MULTI_STRATEGY FOs exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM companies WHERE entity_type = 'FAMILY_OFFICE' AND icp_type = 'ASSET_MANAGER_MULTI_STRATEGY';"
# Should return 0
```

- [ ] No timeouts or 500 errors
- [ ] FO filtering works correctly across endpoints
- [ ] No "approximation" downgrades of FOs
- [ ] Queries complete in <2s

## Phase 14: Monitor First Run

- [ ] Run a Family Office discovery workflow
- [ ] Check FO Run Reporter metrics:
  - Approval rate should be 15-25%
  - Firewall efficiency should reject 30-40%
  - Avg confidence > 0.6
  - Error rate < 5%
- [ ] Verify Apollo feed contains only FO entities
- [ ] Spot-check approved companies are legitimate FOs

## Phase 15: Document Custom Config (If Applicable)

- [ ] Document any custom firewall heuristics added
- [ ] Document custom query patterns for your geography
- [ ] Document confidence thresholds used
- [ ] Add to team wiki/docs

## Final Verification

- [ ] All 9 phases completed ✅
- [ ] No production issues after 24 hours ✅
- [ ] FO export shows more results than before ✅
- [ ] Zero wealth managers in FO approved list ✅
- [ ] Run reports showing improved metrics ✅

## Rollback Plan (If Needed)

```sql
-- Revert all icp_category changes (back to NULL)
UPDATE icps SET icp_category = 'OTHER' WHERE icp_category IN ('FAMILY_OFFICE', 'INVESTMENT_FUND');

-- Revert entity classifications
UPDATE companies SET entity_type = 'UNKNOWN', fo_status = 'UNKNOWN';

-- Restore old export logic (use icp_name instead of icp_category)
```

Keep this on hand but should not need it if testing is thorough.

---

**Estimated Time:** 2-4 hours  
**Difficulty:** Medium  
**Risk:** Low (all changes backward compatible)

## Need Help?

- Check [FO_WORKFLOW_UPGRADE.md](FO_WORKFLOW_UPGRADE.md) for detailed docs
- Review specific service files for implementation details
- Check test results in Phase 5-8
