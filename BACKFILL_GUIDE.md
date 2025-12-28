# Backfill Missing Messages - Usage Guide

## Overview

The `backfill-messages.js` script generates missing connection requests and email messages for existing leads using the OpenAI Outreach Creator agent.

## What It Does

1. **Finds leads missing messages**: Scans all non-disqualified leads for missing `connection_request` or `email_message` fields
2. **Filters smartly**: Only processes leads that have a `company_profile` (required for generating quality messages)
3. **Generates in batches**: Processes 20 leads at a time to avoid API rate limits
4. **Updates database**: Merges generated content with existing `custom_data` without losing other fields

## Prerequisites

- All leads must have `company_profile` in their `custom_data`
- OpenAI API key must be configured
- At least one ICP exists in the database (for instructions)

## Running the Script

```bash
# From project root
node backfill-messages.js
```

## What to Expect

### Console Output:
```
🔄 Starting backfill for missing connection requests and email messages...

📊 Total leads in system: 445
🎯 Leads needing messages: 287
📝 Using outreach instructions from ICP configuration

🔄 Processing 15 batches of up to 20 leads each...

📦 Batch 1/15 (20 leads)...
  ✅ Updated lead 123 (John Doe)
  ✅ Updated lead 124 (Jane Smith)
  ...
  📊 Batch complete: 20/20 successful
  ⏳ Waiting 2000ms before next batch...

...

============================================================
📊 BACKFILL COMPLETE
============================================================
Total leads processed: 287
✅ Successfully updated: 287
❌ Errors: 0
============================================================
```

## Performance

- **Batch size**: 20 leads per batch
- **Delay between batches**: 2 seconds
- **Estimated time**: ~2-3 minutes per 100 leads
- **For 445 leads**: ~10-15 minutes total

## Safety Features

- ✅ **Idempotent**: Won't overwrite existing messages
- ✅ **Preserves data**: Merges with existing `custom_data`
- ✅ **Error handling**: Continues processing even if individual leads fail
- ✅ **Progress tracking**: Shows real-time success/error counts

## Troubleshooting

### "No ICPs found in database"
- Create at least one ICP in the system first
- The script uses ICP's `outreach_creator_instructions`

### "No leads needing messages"
- All leads already have both connection requests and email messages
- Or leads are missing `company_profile` (required)

### Rate limit errors
- Increase `DELAY_BETWEEN_BATCHES` in the script
- Reduce `BATCH_SIZE` to process fewer leads at once

## After Running

1. **Verify in CRM**: Check random leads to see new messages
2. **Export CSV**: Use the new selection feature to export leads with messages
3. **Review quality**: Spot-check a few messages for relevance and tone

## Configuration

Edit these constants in `backfill-messages.js`:

```javascript
const BATCH_SIZE = 20; // Leads per batch
const DELAY_BETWEEN_BATCHES = 2000; // Ms between batches
```

## Next Steps

After backfilling:
- Review Companies page to identify bad leads
- Delete entire companies with irrelevant leads
- Export selected high-quality leads for outreach
