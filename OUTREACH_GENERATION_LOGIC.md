# Outreach Logic Documentation
> **Version 5.1** | Updated: Jan 2026

This document explains exactly how outreach messages are constructed, gated, and quality-controlled.

---

## 1. The Core Philosophy
The system prioritizes **Accuracy over Creativity**.
1. It never invents facts.
2. It assumes broken data is better than "Guessing".
3. If specific data isn't found, it skips or requests manual research rather than sending a generic "Hi, just checking in" message.

---

## 2. The Gating Pipeline (The "Bouncer")
Before any message is generated, the lead must pass 5 gates.

### Gate 1: Check ICP Type
*   **Purpose**: Remove service providers, brokers, and vendors.
*   **Logic**: If `icp_type` contains `BROKERAGE`, `ADVISORY`, `CONSULTING`, etc. → **SKIP**.

### Gate 2: Check Profile Existence
*   **Purpose**: Cannot generate a message without reading the profile.
*   **Logic**: If `company_profile` is empty → **SKIP**.

### Gate 3: Residential Tier (MANDATORY)
*   **Purpose**: Ensure the target is relevant to residential RE.
*   **Logic**: Profile MUST contain at least one:
    *   `residential`, `multifamily`, `apartment`, `condo`, `student housing`, `senior living`, `single family`, etc.
*   **Result**: If missing → **SKIP** ("Tier 2 missing").

### Gate 4: Investor Intent (Tier 1)
*   **Purpose**: Ensure they are an investor/capital source, not just a property manager.
*   **Logic**:
    *   **Investment Firms**: Must match `invests`, `acquisition`, `private equity`, `fund`, `asset management`, etc.
    *   **Family Offices**: If missing keywords → **NEEDS_RESEARCH** (because FOs are often vague).
    *   **Others**: If missing keywords → **SKIP**.

### Gate 5: Direct Investing Evidence (Tier 3)
*   **Purpose**: Filter for firms with proven transaction history.
*   **Logic**: Must match words like `acquired`, `portfolio`, `we invest`, `capital deployed`.
*   **Result**: If missing → **NEEDS_RESEARCH** (Routes to manual review queue for human verification).

---

## 3. Fact Extraction Engine (The "Brain")
Once gated, the system scans the profile text for a "Research Fact" to build the message around. It follows a strict priority list.

### Priority 1: Named Deals (Best)
*   **Goal**: Find a specific property name like "Alpine Village" or "Skyline Tower".
*   **Regex**: Strict capitalization rules. Looks for `[Capitalized Words]` followed by `Apartments|Condos|Tower|Village`, etc.
*   **Example**: "They acquired **Alpine Village** last year..."
*   **Template**: *"Hi [Name], I came across **Alpine Village**... often partner with LP or co-GP capital."*

### Priority 2: Scale Facts (Better)
*   **Goal**: Find specific numbers indicating portfolio size.
*   **Regex**: Looks for numbers + scale keywords (`units`, `apartments`, `properties`, `sq ft`).
*   **Exclusion**: **AUM** is explicitly EXCLUDED here to prevent "Asset Management" phrases from triggering outreach.
*   **Example**: "The firm manages **over 5,000 units**..."
*   **Template**: *"Hi [Name], I noticed **over 5,000 units** in your portfolio... often partner with LP or co-GP capital."*

### Priority 3: Thesis/Strategy (Good)
*   **Goal**: Find the core investment strategy sentence.
*   **Regex**: Scans for sentences containing `focuses on`, `invests in`, `specializes in`.
*   **Smart Trimming**:
    *   Cuts sentence at decent length (~140 chars).
    *   **Grammar Fix**: Converts "We invest..." to "[Company Name] invests..." to sound specific but not awkward.
    *   **Hanging Words**: Tries to cut at logic boundaries (periods, commas) rather than mid-phrase.
*   **Example**: "**Forum invests directly in real estate development (residential) and private equity**"
*   **Template**: *"Hi [Name], I read that **[Company] invests directly...** We work on similar residential strategies..."*

### Priority 4: General Focus (Fallback)
*   **Goal**: Last resort for valid investors with no specific data.
*   **Regex**: Extracts generic focus like "multifamily development in Texas".
*   **Template**: *"Hi [Name], I looking at **[Company]'s focus on the residential sector**..."*

---

## 4. Message Assembly (The "Writer")
The system slots the extracted fact into a rigid template structure.

**Grammar Rules:**
*   **Openers**:
    *   For **PROPER NOUNS** (Deals): *"I came across...", "I noticed..."*
    *   For **SENTENCES** (Thesis): *"I read that...", "I saw that..."* (This prevents "I noticed Forum invests..." which sounds choppy).
*   **Closers**:
    *   Randomly rotates: *"Thought connecting could be worthwhile."*, *"Worth connecting if there's overlap."* (Always capitalized).

**The Final Output (LinkedIn):**
```text
Hi [First Name], 

[Opener] [Research Fact]. [Connection Hook]. [Closer].
```

**The Final Output (Email):**
```text
Hi [First Name],

[LinkedIn Message Body]

If it makes sense, I'm happy to share more information about our current projects.

Best regards,
Roelof van Heeren
Fifth Avenue Properties
```

---

## 5. Quality Assurance (The "Editor")
Before saving, the generated message runs through a final check.

1.  **Length Check**: Must be under 300 characters (for LinkedIn).
2.  **Banned Phrase Check**: If the *generated* text contains prohibited words, it fails to **NEEDS_RESEARCH**.
    *   **Banned**: `international`, `global reach`, `years in business`, `congrats`, `impressed`.
    *   **Why?**: These often indicate the extraction grabbed generic marketing fluff instead of a real fact.

---

## 6. NEEDS_RESEARCH Workflow
When a lead is flagged as `NEEDS_RESEARCH`:
1.  **Status**: Saved to DB with status `NEEDS_RESEARCH` and a specific reason (e.g., `tier_3_missing`).
2.  **Queue**: Automatically added to the Manual Review Queue.
3.  **Action**: Eligible for "Deep Enrich" button in UI -> triggers scraping of portfolio/team pages to find missing data.
4.  **Regeneration**: Can be regenerated after manual or automated profile updates.

---

## Summary of V5.1 Updates
*   **AUM Banned**: Removed 'AUM' from scale extraction to avoid policy flags.
*   **Micro-Hooks**: Added *"partner with LP or co-GP capital"* to Deal/Scale templates.
*   **Fund Structure**: "We/You" Grammar fix now safely replaces "We invest" with "[Company] invests".
*   **Strict Priorities**: Defines `Deals -> Scale -> Thesis -> General` order.
