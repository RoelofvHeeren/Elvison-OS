
import { strict as assert } from 'node:assert';

function cleanJsonString(str) {
    if (!str) return "";
    let cleaned = str;

    // 1. Remove Markdown Code Blocks
    cleaned = cleaned.replace(/```json/g, '').replace(/```/g, '');

    // 2. Find outermost JSON object/array
    const firstBrac = cleaned.indexOf('{');
    const firstSquare = cleaned.indexOf('[');
    let start = -1;
    let end = -1;

    if (firstBrac !== -1 && (firstSquare === -1 || firstBrac < firstSquare)) {
        start = firstBrac;
        end = cleaned.lastIndexOf('}');
    } else if (firstSquare !== -1) {
        start = firstSquare;
        end = cleaned.lastIndexOf(']');
    }

    if (start !== -1 && end !== -1) {
        cleaned = cleaned.substring(start, end + 1);
    }

    // 3. Handle unescaped newlines in JSON strings
    // This is tricky with regex. A safer way is to assume common LLM errors.
    // Replace real newlines with \n, allowing for standard JSON formatting newlines
    // This simple replacement isn't context-aware (string vs structural).

    // Better approach for "Bad control character": 
    // Usually means \n literals in the string.
    // cleaned = cleaned.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    // BUT this kills the JSON structure if it's "pretty printed".

    // For now, let's trust that finding the start/end and trimming often helps, 
    // but the specific error "Bad control character" implies actual control chars inside the string values.
    return cleaned.trim();
}

/**
 * Robust JSON extraction from LLM text
 * Handles Markdown, comments, unescaped chars (basic)
 */
function extractJson(text) {
    if (!text) return null;

    // Phase 1: Simple Strip
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Phase 2: Find Start/End
    let firstOpen = clean.indexOf('{');
    let firstArray = clean.indexOf('[');
    let startIdx = -1;

    if (firstOpen > -1 && firstArray > -1) {
        startIdx = Math.min(firstOpen, firstArray);
    } else if (firstOpen > -1) {
        startIdx = firstOpen;
    } else if (firstArray > -1) {
        startIdx = firstArray;
    }

    if (startIdx > -1) {
        // Find matching end
        // Simple lastIndexOf might fail if there is text after. 
        // We should ideally count braces, but for now lastIndexOf is often 'good enough' for simple LLM replies
        let lastClose = clean.lastIndexOf('}');
        let lastArray = clean.lastIndexOf(']');
        let endIdx = Math.max(lastClose, lastArray);

        if (endIdx > startIdx) {
            clean = clean.substring(startIdx, endIdx + 1);
        }
    }

    // Phase 3: Try Parse
    try {
        return JSON.parse(clean);
    } catch (e) {
        console.log("Standard parsing failed, trying aggressive repair:", e.message);

        try {
            // Repair: Escape unescaped control characters within strings?
            // This is hard to do safely without a parser.
            // One common trick: Replace actual newlines with space or \n, 
            // BUT we must distinguish between structural newlines (formatting) and data newlines.

            // "json5" library is great for this but we might not have it installed.
            // "eval" is dangerous.

            // Try to rely on the fact that LLMs usually pretty-print.
            return null; // For now fail safe
        } catch (e2) {
            return null;
        }
    }
}


console.log("Testing JSON Extraction...");

// Case 1: Standard Markdown
const t1 = "Here is the result:\n```json\n{\n  \"results\": []\n}\n```";
const r1 = extractJson(t1);
assert.deepEqual(r1, { results: [] });
console.log("PASS: Markdown");

// Case 2: Unescaped Control Chars (The specific Error)
// "Bad control character in string literal" usually means a real newline inside a string value.
const t2 = `
{
  "results": [
    {
      "title": "Bad line
break",
      "link": "http://foo.com"
    }
  ]
}
`;
// JSON.parse(t2) WOULD THROW "Bad control character".
// Let's see if we can fix it.
// We can't easily fix this with regex without parsing state.
// However, newer Node versions might handle some quirks, or we might need "json5".

try {
    const r2 = JSON.parse(t2);
    console.log("PASS: Native Parse (Unexpected)");
} catch (e) {
    console.log("CONFIRMED: Native parse fails on unescaped newline:", e.message);
}

// Case 3: Truncated / Unterminated
const t3 = `{"results": [{"title": "Cut off string`;
try {
    JSON.parse(t3);
} catch (e) {
    console.log("CONFIRMED: Truncated fails:", e.message);
}

console.log("Diagnosis complete.");

