import { CompanyProfiler } from './src/backend/services/company-profiler.js';

// Mock scan results
const mockLinks = [
    "https://example.com/about",
    "https://example.com/team",
    "https://example.com/portfolio",
    "https://example.com/family-history",
    "https://example.com/philanthropy",
    "https://example.com/investment-criteria",
    "https://example.com/news/2024-report.pdf",
    "https://example.com/login",
    "https://example.com/contact"
];

function testProfilerLogic() {
    console.log("🧪 Testing Company Profiler Logic...\n");

    // Test 1: Family Office Logic
    console.log("--- 1. Testing Family Office Page Selection ---");
    const foPages = CompanyProfiler._selectBestPages(mockLinks, "Family Corp", "Family Office");
    console.log("Selected Pages:", foPages);

    if (foPages.includes("https://example.com/family-history") && foPages.includes("https://example.com/philanthropy")) {
        console.log("✅ Correctly prioritized family-specific pages.");
    } else {
        console.log("❌ Failed to prioritize family pages.");
    }

    // Test 2: Investment Fund Logic
    console.log("\n--- 2. Testing Investment Fund Page Selection ---");
    const fundPages = CompanyProfiler._selectBestPages(mockLinks, "Fund Corp", "Investment Fund");
    console.log("Selected Pages:", fundPages);

    // Check differentiation: Should NOT prioritize philanthropy, but SHOULD having investment criteria
    if (fundPages.includes("https://example.com/investment-criteria") && !fundPages.includes("https://example.com/philanthropy")) {
        console.log("✅ Correctly prioritized fund-specific pages (excluded philanthropy).");
    } else {
        console.log("❌ Failed to prioritize fund pages.");
    }

    // Test 3: Junk Filtering
    console.log("\n--- 3. Testing Junk Filtering ---");
    const hasJunk = foPages.some(l => l.includes("login") || l.includes(".pdf"));
    if (!hasJunk) {
        console.log("✅ Junk links (PDF, Login) correctly filtered.");
    } else {
        console.log("❌ Failed to filter junk links.");
    }
}

testProfilerLogic();
