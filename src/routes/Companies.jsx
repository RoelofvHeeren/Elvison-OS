import { useEffect, useState } from 'react'
import { Building2, ChevronDown, ChevronUp, Trash2, Users, Search, PlusCircle, Star, Globe } from 'lucide-react'
import { fetchLeads, deleteLead, fetchCompanies, deleteCompany } from '../utils/api'
import { useIcp } from '../context/IcpContext'
import AddCompanyModal from '../components/AddCompanyModal'

function Companies() {
    const [companies, setCompanies] = useState([])
    const [loading, setLoading] = useState(true)
    const [expandedCompany, setExpandedCompany] = useState(null)
    const [filters, setFilters] = useState({ icpId: '' })
    const [cleaning, setCleaning] = useState(false)
    const [cleaningProgress, setCleaningProgress] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')

    // Research State
    const [researchModalOpen, setResearchModalOpen] = useState(false);
    const [researchTarget, setResearchTarget] = useState(null); // { name, website }
    const [researchTopic, setResearchTopic] = useState("Find detailed deal history, recent transactions, and specific property examples.");
    const [researchResult, setResearchResult] = useState(null);
    const [isResearching, setIsResearching] = useState(false);

    // New Multi-Step State
    const [researchStep, setResearchStep] = useState('input'); // 'input', 'scanning', 'selecting', 'analyzing', 'result'
    const [allLinks, setAllLinks] = useState([]);
    const [recommendedLinks, setRecommendedLinks] = useState([]);
    const [selectedLinks, setSelectedLinks] = useState([]);
    const [linkSearch, setLinkSearch] = useState('');
    const [researchProgress, setResearchProgress] = useState(''); // New progress state

    // Add Company Modal State
    const [addCompanyModalOpen, setAddCompanyModalOpen] = useState(false);

    const { icps, fetchIcps } = useIcp()

    const openResearchModal = (company) => {
        setResearchTarget(company);
        setResearchResult(null);
        setResearchStep('input');
        setAllLinks([]);
        setRecommendedLinks([]);
        setSelectedLinks([]);
        setLinkSearch('');
        setResearchProgress('');
        setResearchModalOpen(true);
    };

    const handleScan = async () => {
        if (!researchTarget?.website) return;
        setResearchStep('scanning');
        try {
            const response = await fetch('/api/companies/research/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: researchTarget.website,
                    topic: researchTopic
                })
            });

            if (!response.ok) throw new Error(await response.text());

            const data = await response.json();

            // Deduplicate: exact url match
            const recommended = data.recommended || [];
            const all = data.all || [];

            setRecommendedLinks(recommended);
            setAllLinks(all);

            // Default select highly relevant ones (score > 70)
            const highValueLinks = recommended.filter(l => (l.score || 0) > 70).map(l => l.url);
            setSelectedLinks(highValueLinks.length > 0 ? highValueLinks : recommended.map(l => l.url));

            setResearchStep('selecting');
        } catch (e) {
            console.error(e);
            setResearchResult("Error during scan: " + e.message);
            setResearchStep('result'); // Fallback to showing error
        }
    };

    const handleAnalyze = async () => {
        if (selectedLinks.length === 0) return;
        setResearchStep('analyzing');
        setResearchProgress('Identifying relevant data points...');

        try {
            const response = await fetch('/api/companies/research', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls: selectedLinks,
                    topic: researchTopic,
                    companyName: researchTarget?.name // Add company identifier
                })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Server returned ${response.status}: ${text.slice(0, 100)}...`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'progress') {
                                setResearchProgress(data.message);
                            } else if (data.type === 'complete') {
                                setResearchResult(data.result || "No findings returned.");
                                setResearchStep('result');
                                setResearchProgress('');
                                // Refresh company data to show updated profile
                                await loadCompanies();
                            } else if (data.type === 'error') {
                                throw new Error(data.error);
                            }
                        } catch (e) {
                            console.warn('Parse error', e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
            setResearchResult("Error during analysis: " + e.message);
            setResearchStep('result');
        }
    };

    const handleRegenerateOutreach = async () => {
        if (!researchTarget?.name) return;

        try {
            const response = await fetch(`/api/companies/${encodeURIComponent(researchTarget.name)}/regenerate-outreach`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            console.log('✅ Outreach regenerated:', data);
            alert('Outreach messages regenerated successfully!');
            await loadCompanies(); // Refresh to show updated messages
        } catch (e) {
            console.error('Outreach regeneration failed:', e);
            alert('Failed to regenerate outreach: ' + e.message);
        }
    };

    const handleUpdateProfile = async () => {
        if (!researchTarget?.name || !researchResult) return;

        try {
            const response = await fetch(`/api/companies/${encodeURIComponent(researchTarget.name)}/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ profile: researchResult })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error ${response.status}: ${errText}`);
            }

            console.log('✅ Profile updated');
            alert('Company profile updated successfully!');
            await loadCompanies(); // Refresh UI
        } catch (e) {
            console.error('Update profile failed:', e);
            alert('Failed to update profile: ' + e.message);
        }
    };

    const handleCleanup = async (icpId) => {
        if (!window.confirm("WARNING: This will audit ALL companies in this strategy and DELETE any that score below 6/10. This cannot be undone.\n\nAre you sure?")) {
            return;
        }

        setCleaning(true);
        setCleaningProgress({ processed: 0, total: 0, kept: 0, disqualified: 0 });

        try {
            const response = await fetch(`/api/strategies/${icpId}/cleanup`, {
                method: 'POST'
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'progress') {
                                setCleaningProgress(data.stats);
                            } else if (data.type === 'complete') {
                                alert(`Cleanup Complete!\n\nKept: ${data.stats.kept}\nRemoved: ${data.stats.disqualified}`);
                                loadCompanies(); // Reload
                            } else if (data.type === 'error' || data.error) {
                                alert('Cleanup failed: ' + (data.error || 'Unknown error'));
                            }
                        } catch (e) {
                            console.error('Error parsing SSE:', e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
            alert('Error running cleanup');
        } finally {
            setCleaning(false);
            setCleaningProgress(null);
        }
    }

    useEffect(() => {
        loadCompanies()
        fetchIcps()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.icpId])

    const loadCompanies = async () => {
        setLoading(true)
        try {
            // Pass ICP filter to server
            const params = {};
            if (filters.icpId) params.icpId = filters.icpId;

            const response = await fetchCompanies(params);
            const mappedCompanies = (response.companies || []).map(c => ({
                id: c.id,
                name: c.company_name,
                domain: c.domain,
                website: c.website,
                profile: c.company_profile,
                leadCount: parseInt(c.lead_count || 0),
                fitScore: c.fit_score || 0,
                icpId: c.icp_id,
                last_updated: c.last_updated,
                leads: [] // Empty as we don't load them here anymore
            }));

            setCompanies(mappedCompanies)
        } catch (err) {
            console.error('Failed to load companies:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleDeleteCompany = async (companyId, companyName) => {
        if (!window.confirm(`Delete "${companyName}" and all its leads? This cannot be undone.`)) {
            return
        }

        try {
            await deleteCompany(companyId)

            // Optimistic update
            setCompanies(companies.filter(c => c.id !== companyId))
        } catch (error) {
            console.error('Failed to delete company:', error)
            alert('Failed to delete company. Please try again.')
        }
    }

    const toggleCompanyExpand = (companyName) => {
        setExpandedCompany(expandedCompany === companyName ? null : companyName)
    }

    const renderReportSection = (title, content, icon) => {
        if (!content) return null;

        const formatted = (content || '')
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
            .replace(/\n/g, '<br />');

        return (
            <div className="group/section bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-6 hover:bg-white/[0.06] hover:border-teal-500/30 transition-all duration-300 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 group-hover/section:scale-110 transition-transform duration-300">
                        {icon}
                    </div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-teal-400/90">{title}</h4>
                </div>
                <div
                    className="text-[13px] text-gray-300 leading-[1.8] font-light tracking-wide"
                    dangerouslySetInnerHTML={{ __html: formatted }}
                />
            </div>
        );
    }

    const parseProfileIntoSections = (profileText) => {
        if (!profileText) return {};

        // Standard section names (what we want to display)
        const STANDARD_SECTIONS = [
            'Summary',
            'Investment Strategy',
            'Scale & Geographic Focus',
            'Portfolio Observations',
            'Key Highlights',
            'Fit Analysis'
        ];

        // Map various header formats to standard section names
        const normalizeHeader = (header) => {
            const lower = header.toLowerCase().trim();

            // Summary variations
            if (lower.includes('summary') || lower.includes('overview') || lower === 'about') {
                return 'Summary';
            }
            // Investment Strategy variations
            if (lower.includes('investment strategy') || lower.includes('investment approach') ||
                lower.includes('strategy') && !lower.includes('fit')) {
                return 'Investment Strategy';
            }
            // Scale & Geographic Focus variations
            if (lower.includes('scale') || lower.includes('geographic') || lower.includes('geography') ||
                lower.includes('aum') || lower.includes('assets under management') || lower.includes('locations')) {
                return 'Scale & Geographic Focus';
            }
            // Portfolio Observations variations
            if (lower.includes('portfolio') || lower.includes('deal history') || lower.includes('deals') ||
                lower.includes('transactions') || lower.includes('investments') || lower.includes('holdings')) {
                return 'Portfolio Observations';
            }
            // Key Highlights variations
            if (lower.includes('highlight') || lower.includes('key people') || lower.includes('management') ||
                lower.includes('team') || lower.includes('leadership') || lower.includes('key facts')) {
                return 'Key Highlights';
            }
            // Fit Analysis variations
            if (lower.includes('fit') || lower.includes('analysis') || lower.includes('alignment') ||
                lower.includes('match') || lower.includes('score')) {
                return 'Fit Analysis';
            }

            return null; // Not a recognized section header
        };

        const sections = {};

        // 1. Clean the text (normalize newlines, removing markdown artifacts that aren't headers)
        let cleanText = profileText.replace(/\r\n/g, '\n');

        // 2. Identify all possible section start positions
        const foundSections = [];

        // Iterate through standard sections to find them in text
        // We look for patterns like:
        // **Summary**:
        // # Summary
        // Summary:
        // And variations defined in normalizeHeader

        const KEYWORDS = [
            'Summary', 'Executive Summary', 'General Overview', 'Company Overview', 'Overview',
            'Investment Strategy', 'Investment Approach', 'Strategy',
            'Scale & Geographic Focus', 'Scale', 'Geography', 'Geographic Focus', 'AUM', 'Scale & Geography',
            'Portfolio Observations', 'Portfolio', 'Deal History', 'Recent Transactions', 'Investments', 'Portfolio Highlights',
            'Key Highlights', 'Highlights', 'Key People', 'Management Team', 'Team',
            'Fit Analysis', 'Strategic Fit', 'Fit Score', 'Fit'
        ];

        // Improved Regex to match:
        // 1. Markdown headers: # Summary (at start of line)
        // 2. Bold/Colon headers: **Summary**:, Summary:, Summary**:
        // 3. Inline headers: ...text. Summary: ...

        // We construct a regex that looks for:
        // (Start of line OR whitespace/punctuation) 
        // (Optional # or **)
        // KEYWORD
        // (Optional **) 
        // (Colon OR End of line OR just whitespace if it was a #-style header)

        // To be safe, we match specifically two patterns:
        // A) Strict Markdown Header (Start of line, #, Keyword, End of line/Newline)
        // B) Labeled Header (Keyword followed by colon or bold-colon)

        const escapedKeywords = KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

        // Matches: # Keyword (at newline)
        const markdownRegex = new RegExp(`(^|\\n)\\s*#+\\s*(${escapedKeywords})\\s*($|\\n)`, 'gi');

        // Matches: Keyword: or **Keyword**: or Keyword**:
        const labeledRegex = new RegExp(`(^|\\s|\\.|\\*)\\s*(${escapedKeywords})\\s*(\\*\\*)?:`, 'gi');

        // Collect matches from both strategies
        let match;

        while ((match = markdownRegex.exec(cleanText)) !== null) {
            const keyword = match[2];
            const standardName = normalizeHeader(keyword);
            if (standardName) {
                foundSections.push({
                    name: standardName,
                    index: match.index,
                    length: match[0].length,
                    priority: 1 // High priority (strict markdown)
                });
            }
        }

        while ((match = labeledRegex.exec(cleanText)) !== null) {
            const keyword = match[2];
            const standardName = normalizeHeader(keyword);
            // Avoid duplicates if same range captured (e.g. # Summary: could match both)
            const existing = foundSections.find(s => Math.abs(s.index - match.index) < 5);

            if (standardName && !existing) {
                foundSections.push({
                    name: standardName,
                    index: match.index,
                    length: match[0].length,
                    priority: 2
                });
            }
        }

        // Sort by position
        foundSections.sort((a, b) => a.index - b.index);

        // Filter out overlapping sections (keep highest priority or first one)
        const uniqueSections = [];
        if (foundSections.length > 0) {
            uniqueSections.push(foundSections[0]);
            for (let i = 1; i < foundSections.length; i++) {
                const prev = uniqueSections[uniqueSections.length - 1];
                const curr = foundSections[i];
                if (curr.index >= prev.index + prev.length) {
                    uniqueSections.push(curr);
                }
            }
        }

        // 3. Extract content
        if (uniqueSections.length > 0) {
            // Check for text BEFORE the first section (Headerless Summary)
            if (uniqueSections[0].index > 0) {
                const introText = cleanText.substring(0, uniqueSections[0].index).trim();
                // Clean up any leading dashed lines causing markdown bullets
                const cleanIntro = introText.replace(/^[-*]\s+/gm, '• ').trim();

                if (cleanIntro && cleanIntro.length > 10) { // Ignore tiny noise
                    sections['Summary'] = cleanIntro;
                }
            }

            uniqueSections.forEach((section, i) => {
                const nextSection = uniqueSections[i + 1];
                const start = section.index + section.length;
                const end = nextSection ? nextSection.index : cleanText.length;

                let content = cleanText.substring(start, end).trim();

                // Clean up leading/trailing artifacts
                content = content.replace(/^[:\-\s]+/, '').replace(/[:\-\s]+$/, '');
                // Fix bullets
                content = content.replace(/^-\s*\*\*/gm, '• **').replace(/^-\s+/gm, '• ');

                if (sections[section.name]) {
                    sections[section.name] += '\n\n' + content;
                } else {
                    sections[section.name] = content;
                }
            });
        } else {
            // Fallback: If absolutely no headers found, put it all in Summary
            sections['Summary'] = cleanText.trim();
        }



        return sections;
    }

    return (
        <div className="min-h-screen p-6 lg:p-8">
            <div className="max-w-[1400px] mx-auto space-y-6">
                {/* Header */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="font-serif text-3xl font-bold text-white flex items-center gap-3">
                                <Building2 className="w-8 h-8 text-[#139187]" />
                                Companies
                            </h1>
                            <p className="text-sm text-gray-400 mt-1">
                                Review all companies with leads, view company profiles, and clean up bad data.
                            </p>
                        </div>

                        <button
                            onClick={() => setAddCompanyModalOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 text-teal-400 rounded-xl text-sm font-bold transition-all border border-teal-500/30"
                        >
                            <PlusCircle className="w-4 h-4" />
                            Add Company
                        </button>
                    </div>
                    {/* Data Repair Button (Temporary) */}
                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={async () => {
                                if (!confirm('This will verify all leads and restore any missing companies. Continue?')) return;
                                try {
                                    const res = await fetch('/api/admin/backfill-companies', { method: 'POST' });
                                    const data = await res.json();
                                    alert(data.message);
                                    window.location.reload();
                                } catch (e) {
                                    alert('Failed: ' + e.message);
                                }
                            }}
                            className="text-xs text-gray-500 hover:text-teal-400 underline decoration-dotted transition-colors"
                        >
                            Run Data Repair / Restore Missing Companies
                        </button>
                        <button
                            onClick={async () => {
                                if (!confirm('⚠️ DEEP CLEANUP: This will re-score ALL companies using AI and DELETE those below threshold (8 for Family Offices, 6 for Funds). This may take 5-10 minutes. Continue?')) return;

                                const statusDiv = document.createElement('div');
                                statusDiv.id = 'cleanup-status';
                                statusDiv.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50';
                                statusDiv.innerHTML = `
                                    <div class="bg-gray-900 p-8 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-auto">
                                        <h2 class="text-xl font-bold text-white mb-4">🧹 Deep Cleanup in Progress</h2>
                                        <div id="cleanup-log" class="text-sm text-gray-300 space-y-1 font-mono"></div>
                                        <div id="cleanup-summary" class="mt-4 p-4 bg-black/50 rounded-xl hidden"></div>
                                        <button id="cleanup-close" class="mt-4 px-4 py-2 bg-teal-500 text-white rounded-lg hidden">Close & Refresh</button>
                                    </div>
                                `;
                                document.body.appendChild(statusDiv);
                                const log = document.getElementById('cleanup-log');
                                const summary = document.getElementById('cleanup-summary');
                                const closeBtn = document.getElementById('cleanup-close');

                                try {
                                    const res = await fetch('/api/admin/deep-cleanup', { method: 'POST' });
                                    const reader = res.body.getReader();
                                    const decoder = new TextDecoder();

                                    while (true) {
                                        const { value, done } = await reader.read();
                                        if (done) break;
                                        const chunk = decoder.decode(value);
                                        const lines = chunk.split('\n\n');
                                        for (const line of lines) {
                                            if (line.startsWith('data: ')) {
                                                try {
                                                    const data = JSON.parse(line.slice(6));
                                                    if (data.type === 'scored') {
                                                        const color = data.action === 'DELETE' ? 'text-red-400' : 'text-green-400';
                                                        log.innerHTML += `<div class="${color}">${data.action} ${data.company} (Score: ${data.score}/${data.threshold}) - ${data.reason}</div>`;
                                                    } else if (data.type === 'status' || data.type === 'scraping') {
                                                        log.innerHTML += `<div class="text-blue-400">${data.message || 'Scraping ' + data.company + '...'}</div>`;
                                                    } else if (data.type === 'progress') {
                                                        log.innerHTML += `<div class="text-yellow-400">Progress: ${data.processed}/${data.total} - Kept: ${data.kept}, Deleted: ${data.deleted}</div>`;
                                                    } else if (data.type === 'complete') {
                                                        summary.classList.remove('hidden');
                                                        summary.innerHTML = `
                                                            <h3 class="text-lg font-bold text-white mb-2">✅ Cleanup Complete!</h3>
                                                            <p class="text-green-400">Kept: ${data.results.kept} companies</p>
                                                            <p class="text-red-400">Deleted: ${data.results.deleted} companies</p>
                                                            <p class="text-blue-400">Scraped: ${data.results.scraped} websites</p>
                                                            <p class="text-gray-400">Errors: ${data.results.errors}</p>
                                                        `;
                                                        closeBtn.classList.remove('hidden');
                                                    }
                                                    log.scrollTop = log.scrollHeight;
                                                } catch (e) { }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    log.innerHTML += `<div class="text-red-500">Error: ${e.message}</div>`;
                                }

                                closeBtn.onclick = () => {
                                    statusDiv.remove();
                                    window.location.reload();
                                };
                            }}
                            className="ml-4 text-xs text-orange-500 hover:text-orange-400 underline decoration-dotted transition-colors font-bold"
                        >
                            🧹 Run DEEP Cleanup (AI Re-score All)
                        </button>
                        <button
                            onClick={async () => {
                                if (!confirm('🔒 DEEP CLEANUP V2: This uses the HARDCODED company action spec to:\n\n✅ Delete service providers, wealth managers, tech vendors\n✅ Keep real investors with proper ICP classification\n✅ Merge duplicates and subsidiaries\n✅ Clean up leads with bad titles\n✅ Rebuild all fit scores (0-10)\n\nThis is the PRODUCTION cleanup. Continue?')) return;

                                const statusDiv = document.createElement('div');
                                statusDiv.id = 'cleanup-status';
                                statusDiv.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50';
                                statusDiv.innerHTML = `
                                    <div class="bg-gray-900 p-8 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto">
                                        <h2 class="text-xl font-bold text-white mb-4">🔒 Deep Cleanup V2 - Production Cleanup</h2>
                                        <div id="cleanup-log" class="text-sm text-gray-300 space-y-1 font-mono max-h-96 overflow-auto"></div>
                                        <div id="cleanup-summary" class="mt-4 p-4 bg-black/50 rounded-xl hidden"></div>
                                        <button id="cleanup-close" class="mt-4 px-4 py-2 bg-teal-500 text-white rounded-lg hidden">Close & Refresh</button>
                                    </div>
                                `;
                                document.body.appendChild(statusDiv);
                                const log = document.getElementById('cleanup-log');
                                const summary = document.getElementById('cleanup-summary');
                                const closeBtn = document.getElementById('cleanup-close');

                                try {
                                    const res = await fetch('/api/admin/deep-cleanup-v2', { method: 'POST' });
                                    const reader = res.body.getReader();
                                    const decoder = new TextDecoder();

                                    while (true) {
                                        const { value, done } = await reader.read();
                                        if (done) break;
                                        const chunk = decoder.decode(value);
                                        const lines = chunk.split('\n\n');
                                        for (const line of lines) {
                                            if (line.startsWith('data: ')) {
                                                try {
                                                    const data = JSON.parse(line.slice(6));
                                                    if (data.type === 'action') {
                                                        const colors = {
                                                            'DELETED': 'text-red-400',
                                                            'KEPT': 'text-green-400',
                                                            'MERGED': 'text-yellow-400',
                                                            'REVIEW_REQUIRED': 'text-orange-400'
                                                        };
                                                        log.innerHTML += `<div class="${colors[data.status] || 'text-gray-400'}">${data.status}: ${data.company}${data.icp_type ? ' (' + data.icp_type + ')' : ''}${data.fit_score !== undefined ? ' [Score: ' + data.fit_score + ']' : ''}</div>`;
                                                    } else if (data.type === 'status' || data.type === 'phase') {
                                                        log.innerHTML += `<div class="text-blue-400 font-bold">${data.message}</div>`;
                                                    } else if (data.type === 'progress') {
                                                        log.innerHTML += `<div class="text-purple-400">Progress: ${data.processed}/${data.total} | Kept: ${data.kept} | Deleted: ${data.deleted} | Merged: ${data.merged}</div>`;
                                                    } else if (data.type === 'complete') {
                                                        summary.classList.remove('hidden');
                                                        summary.innerHTML = `
                                                            <h3 class="text-lg font-bold text-white mb-2">✅ Deep Cleanup V2 Complete!</h3>
                                                            <div class="grid grid-cols-3 gap-4 text-sm">
                                                                <div><span class="text-green-400 font-bold">${data.results.kept}</span> Kept</div>
                                                                <div><span class="text-red-400 font-bold">${data.results.deleted}</span> Deleted</div>
                                                                <div><span class="text-yellow-400 font-bold">${data.results.merged}</span> Merged</div>
                                                                <div><span class="text-orange-400 font-bold">${data.results.review_required}</span> Review Required</div>
                                                                <div><span class="text-blue-400 font-bold">${data.results.leads_deleted}</span> Leads Deleted</div>
                                                                <div><span class="text-gray-400 font-bold">${data.results.errors}</span> Errors</div>
                                                            </div>
                                                            ${data.qaReport?.duplicates?.length ? '<div class="mt-4 text-yellow-400">⚠️ ' + data.qaReport.duplicates.length + ' duplicate domains found</div>' : ''}
                                                        `;
                                                        closeBtn.classList.remove('hidden');
                                                    }
                                                    log.scrollTop = log.scrollHeight;
                                                } catch (e) { }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    log.innerHTML += `<div class="text-red-500">Error: ${e.message}</div>`;
                                }

                                closeBtn.onclick = () => {
                                    statusDiv.remove();
                                    window.location.reload();
                                };
                            }}
                            className="ml-4 text-xs text-purple-500 hover:text-purple-400 underline decoration-dotted transition-colors font-bold"
                        >
                            🔒 V2: Full Spec Cleanup
                        </button>
                        <button
                            onClick={async () => {
                                try {
                                    const res = await fetch('/api/admin/fix-icp-types', { method: 'POST' });
                                    const data = await res.json();
                                    alert(`✅ ICP Types Fixed!\n\nUpdated: ${data.updated}\nErrors: ${data.errors}\nTotal: ${data.total}\n\nRefresh to see changes.`);
                                    window.location.reload();
                                } catch (e) {
                                    alert('Error: ' + e.message);
                                }
                            }}
                            className="ml-4 text-xs text-cyan-500 hover:text-cyan-400 underline decoration-dotted transition-colors"
                        >
                            ⚡ Quick Fix ICP Types
                        </button>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6">
                        <p className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1">Total Companies</p>
                        <p className="text-3xl font-bold text-white">{companies.length}</p>
                    </div>
                    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-4">
                        <p className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1">Total Leads</p>
                        <p className="text-3xl font-bold text-white">
                            {companies.reduce((sum, c) => sum + c.leadCount, 0)}
                        </p>
                    </div>
                    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-4">
                        <p className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1">Avg Leads/Company</p>
                        <p className="text-3xl font-bold text-white">
                            {companies.length > 0
                                ? (companies.reduce((sum, c) => sum + c.leadCount, 0) / companies.length).toFixed(1)
                                : '0'}
                        </p>
                    </div>
                </div>

                {/* ICP Filter & Actions */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {icps.length > 0 && (
                        <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-4 flex-1">
                            <label className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-2 block">
                                Filter by ICP
                            </label>
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col md:flex-row gap-4 mb-6">
                                    {/* Search Input */}
                                    <div className="relative flex-1 group min-w-[300px]">
                                        <div className="absolute inset-0 bg-gradient-to-r from-teal-500/10 to-blue-500/10 rounded-xl blur opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                        <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl flex items-center p-3 transition-colors hover:bg-white/[0.07] focus-within:bg-white/[0.09] focus-within:border-teal-500/30">
                                            <Search className="w-4 h-4 text-gray-400 mr-3" />
                                            <input
                                                type="text"
                                                placeholder="Search companies..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="bg-transparent border-none outline-none text-white text-sm w-full placeholder-gray-500"
                                            />
                                        </div>
                                    </div>

                                    <select
                                        value={filters.icpId}
                                        onChange={(e) => setFilters({ icpId: e.target.value })}
                                        className="w-full md:w-64 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-all appearance-none"
                                    >
                                        <option value="">All ICPs</option>
                                        {icps.map(icp => (
                                            <option key={icp.id} value={icp.id}>{icp.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {filters.icpId && (
                                    <div className="flex items-center gap-4">
                                        <button
                                            className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                            onClick={() => window.document.getElementById('rules_modal').showModal()}
                                        >
                                            View Scoring Rules
                                        </button>

                                        {cleaning && cleaningProgress && (
                                            <div className="text-xs text-gray-400 font-mono">
                                                <span className="text-white font-bold">{cleaningProgress.processed}</span>/{cleaningProgress.total}
                                                <span className="ml-2 text-green-400">Kept: {cleaningProgress.kept}</span>
                                                <span className="ml-2 text-rose-400">Drop: {cleaningProgress.disqualified}</span>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => handleCleanup(filters.icpId)}
                                            disabled={cleaning}
                                            className={`
                                                px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all
                                                ${cleaning
                                                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20'
                                                }
                                            `}
                                        >
                                            <Trash2 className={`w-4 h-4 ${cleaning ? 'animate-spin' : ''}`} />
                                            {cleaning ? 'Cleaning...' : 'Cleanup Strategy'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="text-center py-20">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500 mx-auto mb-4"></div>
                        <p className="text-gray-400">Loading companies...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {companies
                            .filter(company =>
                            (!searchQuery ||
                                company.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                company.website?.toLowerCase().includes(searchQuery.toLowerCase()))
                            )
                            .map((company) => (
                                <div key={company.name} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
                                    {/* Company Header */}
                                    <div
                                        className="p-6 cursor-pointer hover:bg-white/5 transition-colors flex items-center justify-between"
                                        onClick={() => toggleCompanyExpand(company.name)}
                                    >
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className="flex-shrink-0">
                                                <div className="w-14 h-14 rounded-full bg-[#139187]/10 border border-[#139187]/20 flex items-center justify-center">
                                                    <Building2 className="w-7 h-7 text-[#139187]" />
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-semibold text-white text-lg">{company.name}</h3>
                                                {company.website && (
                                                    <a
                                                        href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-sm text-teal-400 hover:underline"
                                                    >
                                                        {company.website}
                                                    </a>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            {company.fitScore !== 'N/A' && (
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className="text-[10px] uppercase tracking-widest font-black text-gray-500">Fit Score</span>
                                                    <span className={`px-4 py-1.5 rounded-full text-xs font-black border-2 shadow-lg ${parseInt(company.fitScore) >= 8
                                                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                                        : parseInt(company.fitScore) >= 6
                                                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                                                            : 'bg-white/10 text-gray-400 border-white/10'
                                                        }`}>
                                                        {company.fitScore} / 10
                                                    </span>
                                                </div>
                                            )}
                                            <div className="h-10 w-[1px] bg-white/10 mx-2"></div>
                                            <div className="text-right">
                                                <p className="text-xl font-black text-white">{company.leadCount}</p>
                                                <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Decision Makers</p>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDeleteCompany(company.id, company.name)
                                                }}
                                                className="ml-4 p-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl transition-all border border-rose-500/20 group/del"
                                                title="Delete company"
                                            >
                                                <Trash2 className="h-5 w-5 group-hover/del:scale-110 transition-transform" />
                                            </button>
                                            <div className="ml-2">
                                                {expandedCompany === company.name ? (
                                                    <ChevronUp className="h-6 w-6 text-teal-400" />
                                                ) : (
                                                    <ChevronDown className="h-6 w-6 text-gray-600" />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Content */}
                                    {expandedCompany === company.name && (
                                        <div className="border-t border-white/[0.05] p-10 bg-gradient-to-b from-black/60 to-black/40">
                                            {/* Company Report Section */}
                                            <div className="mb-14">
                                                <div className="flex items-center gap-4 mb-10">
                                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-teal-500/20 to-teal-500/20"></div>
                                                    <span className="text-[11px] uppercase tracking-[0.4em] font-black text-teal-500/50">Market Intelligence Report</span>
                                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-teal-500/20 via-teal-500/20 to-transparent"></div>

                                                    <button
                                                        onClick={() => openResearchModal(company)}
                                                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border border-teal-500/20"
                                                    >
                                                        <Search className="w-3 h-3" />
                                                        Deep Research
                                                    </button>
                                                </div>

                                                {company.profile ? (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                        {(() => {
                                                            const sections = parseProfileIntoSections(company.profile);
                                                            const DISPLAY_ORDER = [
                                                                'Summary',
                                                                'Investment Strategy',
                                                                'Scale & Geographic Focus',
                                                                'Portfolio Observations',
                                                                'Key Highlights',
                                                                'Fit Analysis'
                                                            ];

                                                            const defaultIcons = {
                                                                'Summary': <Building2 className="w-4 h-4 text-teal-400" />,
                                                                'Investment Strategy': <Users className="w-4 h-4 text-purple-400" />,
                                                                'Scale & Geographic Focus': <Globe className="w-4 h-4 text-orange-400" />,
                                                                'Portfolio Observations': <Building2 className="w-4 h-4 text-blue-400" />,
                                                                'Key Highlights': <Star className="w-4 h-4 text-yellow-400" />,
                                                                'Fit Analysis': <div className="w-4 h-4 rounded-full border-2 border-green-500/50 flex items-center justify-center text-[10px] font-bold text-green-400">✓</div>
                                                            };

                                                            return DISPLAY_ORDER.map(title => {
                                                                if (!sections[title]) return null;
                                                                return (
                                                                    <div key={title} className={title === 'Summary' || title === 'Fit Analysis' ? 'col-span-1 md:col-span-2' : ''}>
                                                                        {renderReportSection(title, sections[title], defaultIcons[title] || <Building2 className="w-4 h-4 text-teal-400" />)}
                                                                    </div>
                                                                );
                                                            });
                                                        })()}
                                                    </div>
                                                ) : (
                                                    <div className="p-20 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/10 backdrop-blur-sm">
                                                        <Building2 className="w-12 h-12 text-gray-700 mx-auto mb-4 opacity-20" />
                                                        <p className="text-gray-500 font-medium tracking-wide">Detailed intelligence report in progress...</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Contact Decision Makers Section */}
                                            <div className="space-y-6">
                                                <div className="flex items-center gap-4 mb-8">
                                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-purple-500/20 to-purple-500/20"></div>
                                                    <span className="text-[11px] uppercase tracking-[0.4em] font-black text-purple-500/50">Identified Decision Makers</span>
                                                    <div className="h-[1px] flex-1 bg-gradient-to-r from-purple-500/20 via-purple-500/20 to-transparent"></div>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                    {company.leads.map((lead) => {
                                                        const initials = lead.personName?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?'
                                                        return (
                                                            <div key={lead.id} className="group/lead relative flex flex-col p-6 bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-3xl hover:bg-white/[0.07] hover:border-purple-500/30 transition-all duration-500 shadow-2xl shadow-black/40">
                                                                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover/lead:opacity-30 transition-opacity">
                                                                    <Users className="w-12 h-12 text-purple-400" />
                                                                </div>

                                                                <div className="flex items-start justify-between mb-6">
                                                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-teal-500/20 border border-white/10 flex items-center justify-center group-hover/lead:scale-110 transition-transform duration-500 shadow-lg">
                                                                        <span className="text-white font-black text-sm tracking-tighter">{initials}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {lead.linkedinUrl && (
                                                                            <a
                                                                                href={lead.linkedinUrl}
                                                                                target="_blank"
                                                                                rel="noreferrer"
                                                                                className="p-2.5 bg-white/5 rounded-xl text-gray-400 hover:text-white hover:bg-purple-500/30 transition-all border border-white/5 shadow-inner"
                                                                            >
                                                                                <Users className="w-4 h-4" />
                                                                            </a>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="min-w-0 relative z-10">
                                                                    <h4 className="font-bold text-white text-lg tracking-tight truncate mb-1">{lead.personName}</h4>
                                                                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] truncate mb-6">{lead.jobTitle || 'Business Leader'}</p>
                                                                </div>
                                                                {lead.email && (
                                                                    <a
                                                                        href={`mailto:${lead.email}`}
                                                                        className="w-full py-3.5 bg-white text-black hover:bg-teal-400 hover:text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all duration-300 text-center shadow-xl shadow-black/20"
                                                                    >
                                                                        Request Intro
                                                                    </a>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                    </div>
                )}
            </div>

            <dialog id="rules_modal" className="modal bg-[#0A0A0A] border border-white/10 rounded-2xl p-0 backdrop-blur-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden text-gray-200">
                <div className="flex flex-col h-full bg-[#111]">
                    <div className="flex items-center justify-between p-6 border-b border-white/5 bg-[#0f0f0f]">
                        <h3 className="text-xl font-serif font-bold text-white">Scoring & Qualification Strategy</h3>
                        <button
                            onClick={() => window.document.getElementById('rules_modal').close()}
                            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-8 overflow-y-auto space-y-8">
                        {/* Family Office */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-teal-500/10 rounded-lg border border-teal-500/20">
                                    <Building2 className="w-5 h-5 text-teal-400" />
                                </div>
                                <h4 className="text-lg font-bold text-white">Strategy 1: Family Offices</h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                                <div>
                                    <h5 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">Target Profile</h5>
                                    <ul className="space-y-2 text-sm text-gray-300 list-disc list-inside marker:text-teal-500">
                                        <li><strong className="text-white">Single Family Offices (SFO)</strong> managing private wealth.</li>
                                        <li><strong className="text-white">Multi-Family Offices (MFO)</strong> with direct investment mandates.</li>
                                        <li>Private Wealth firms that actively <strong className="text-teal-400">INVEST CAPITAL</strong>.</li>
                                    </ul>
                                </div>
                                <div>
                                    <h5 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">Scoring Logic</h5>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-green-400">8-10</span>
                                            <span>Explicit SFO/MFO with direct Real Estate/PE arm.</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-blue-400">6-7</span>
                                            <span>Private Wealth/Advisory firms that imply direct deals or discretion. (Kept for review)</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-rose-400">1-5</span>
                                            <span className="text-gray-400">Retail advisors, pure brokers, tenants (Disqualified).</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Investment Firms */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
                                    <Users className="w-5 h-5 text-purple-400" />
                                </div>
                                <h4 className="text-lg font-bold text-white">Strategy 2: Investment Firms</h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                                <div>
                                    <h5 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">Target Profile</h5>
                                    <ul className="space-y-2 text-sm text-gray-300 list-disc list-inside marker:text-purple-500">
                                        <li><strong className="text-white">Private Equity Real Estate</strong> firms.</li>
                                        <li><strong className="text-white">REITs</strong> & Pension Funds.</li>
                                        <li>Asset Managers with <strong className="text-purple-400">DIRECT</strong> investment vehicles.</li>
                                        <li>Holdings/Group companies with RE assets.</li>
                                    </ul>
                                </div>
                                <div>
                                    <h5 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">Scoring Logic</h5>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-green-400">8-10</span>
                                            <span>Dedicated REPE, REIT, or Institutional Investor.</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-blue-400">6-7</span>
                                            <span>Generalist PE, Holdings Co, multi-strategy firms. (Kept for review)</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <span className="font-mono font-bold text-rose-400">1-5</span>
                                            <span className="text-gray-400">Pure Service Providers (Law/Tax), Brokers, Debt-only Lenders.</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 border-t border-white/5 bg-[#0f0f0f] text-right">
                        <button
                            onClick={() => window.document.getElementById('rules_modal').close()}
                            className="px-6 py-2 bg-white text-black font-bold uppercase tracking-wider text-xs rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </dialog>

            {/* Research Modal */}
            {
                researchModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
                            <div className="flex items-center justify-between p-6 border-b border-white/5">
                                <h3 className="text-xl font-serif font-bold text-white flex items-center gap-2">
                                    <Search className="w-5 h-5 text-teal-400" />
                                    Deep Research: <span className="text-teal-400">{researchTarget?.name}</span>
                                </h3>
                                <button
                                    onClick={() => setResearchModalOpen(false)}
                                    className="text-gray-400 hover:text-white transition-colors"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="p-6 flex-1 overflow-y-auto space-y-6">
                                {researchStep === 'result' ? (
                                    <div className="space-y-4">
                                        <div className="prose prose-invert prose-sm max-w-none">
                                            <h4 className="text-teal-400 font-bold uppercase tracking-widest text-xs mb-4">Research Findings</h4>
                                            <div className="bg-white/5 rounded-xl p-6 border border-white/10 whitespace-pre-wrap">
                                                {researchResult}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Step 1: Input */}
                                        {researchStep === 'input' && (
                                            <>
                                                <div>
                                                    <label className="block text-xs uppercase tracking-wider font-bold text-gray-500 mb-2">Research Goal</label>
                                                    <textarea
                                                        value={researchTopic}
                                                        onChange={(e) => setResearchTopic(e.target.value)}
                                                        className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-teal-500/50 min-h-[100px]"
                                                        placeholder="What specifically do you want to find?"
                                                    />
                                                </div>
                                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
                                                    <div className="p-1 bg-blue-500/20 rounded-full mt-0.5">
                                                        <Search className="w-3 h-3 text-blue-400" />
                                                    </div>
                                                    <div className="text-sm text-blue-200">
                                                        <p className="font-bold mb-1">How this works</p>
                                                        <p className="opacity-80">Our AI agent will verify the sitemap and suggest pages to crawl based on your topic. You can then select specific pages for deep analysis.</p>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* Step 2: Scanning Loading */}
                                        {researchStep === 'scanning' && (
                                            <div className="text-center py-12">
                                                <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500 mb-4"></div>
                                                <p className="text-teal-400 font-mono text-sm animate-pulse">Scanning site structure...</p>
                                            </div>
                                        )}

                                        {/* Step 3: Select Links */}
                                        {researchStep === 'selecting' && (
                                            <>
                                                <div className="flex items-center justify-between mb-4">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white uppercase tracking-wider">Select Pages to Analyze</h4>
                                                        <p className="text-xs text-gray-400">Select any pages you want the AI to read.</p>
                                                    </div>
                                                    <span className="text-xs font-mono px-2 py-1 bg-teal-500/20 text-teal-400 rounded-lg">{selectedLinks.length} selected</span>
                                                </div>

                                                {/* AI Recommendations */}
                                                <div className="mb-6">
                                                    <h5 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
                                                        AI Recommended
                                                    </h5>
                                                    <div className="space-y-2">
                                                        {recommendedLinks.map((link, idx) => (
                                                            <div key={'rec' + idx}
                                                                onClick={() => {
                                                                    if (selectedLinks.includes(link.url)) {
                                                                        setSelectedLinks(selectedLinks.filter(l => l !== link.url));
                                                                    } else {
                                                                        setSelectedLinks([...selectedLinks, link.url]);
                                                                    }
                                                                }}
                                                                className={`group p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${selectedLinks.includes(link.url)
                                                                    ? 'bg-teal-500/10 border-teal-500/50 shadow-[0_0_15px_-3px_rgba(20,184,166,0.2)]'
                                                                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                                                                    }`}
                                                            >
                                                                <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedLinks.includes(link.url) ? 'bg-teal-500 border-teal-500' : 'border-gray-600 group-hover:border-gray-400'
                                                                    }`}>
                                                                    {selectedLinks.includes(link.url) && <div className="w-2.5 h-2.5 bg-black rounded-sm" />}
                                                                </div>
                                                                <div className="flex-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="text-sm font-bold text-gray-200">{link.title || link.url}</div>
                                                                        {link.score && <div className="text-[10px] font-mono bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded">{link.score}% match</div>}
                                                                    </div>
                                                                    <div className="text-xs text-gray-500 break-all line-clamp-1">{link.url}</div>
                                                                    {link.reason && <div className="text-xs text-teal-400/80 mt-1 italic">"{link.reason}"</div>}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* All Other Links */}
                                                <div>
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest">All Found Pages ({allLinks.length})</h5>
                                                        <input
                                                            type="text"
                                                            placeholder="Filter links..."
                                                            value={linkSearch}
                                                            onChange={(e) => setLinkSearch(e.target.value)}
                                                            className="bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-teal-500/50 w-32"
                                                        />
                                                    </div>
                                                    <div className="space-y-1 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                                        {allLinks
                                                            .filter(l => {
                                                                const isRecommended = l.reason; // Check if it has a reason, meaning it's in recommended
                                                                const matchesSearch = !linkSearch || (l.title && l.title.toLowerCase().includes(linkSearch.toLowerCase())) || l.url.toLowerCase().includes(linkSearch.toLowerCase());
                                                                return !isRecommended && matchesSearch;
                                                            })
                                                            .map((link, idx) => (
                                                                <div key={'all' + idx}
                                                                    onClick={() => {
                                                                        if (selectedLinks.includes(link.url)) {
                                                                            setSelectedLinks(selectedLinks.filter(l => l !== link.url));
                                                                        } else {
                                                                            setSelectedLinks([...selectedLinks, link.url]);
                                                                        }
                                                                    }}
                                                                    className={`p-2 rounded-lg border cursor-pointer transition-all flex items-center gap-3 ${selectedLinks.includes(link.url)
                                                                        ? 'bg-blue-500/10 border-blue-500/30'
                                                                        : 'bg-transparent border-transparent hover:bg-white/5'
                                                                        }`}
                                                                >
                                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedLinks.includes(link.url) ? 'bg-blue-500 border-blue-500' : 'border-gray-700'
                                                                        }`}>
                                                                        {selectedLinks.includes(link.url) && <div className="w-2 h-2 bg-black rounded-sm" />}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="text-xs font-bold text-gray-200 truncate">{link.title || 'Untitled Link'}</div>
                                                                        <div className="text-[10px] text-gray-400 truncate opacity-70">{link.url}</div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* Step 4: Analyzing Loading */}
                                        {researchStep === 'analyzing' && (
                                            <div className="text-center py-12">
                                                <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500 mb-4"></div>
                                                <p className="text-teal-400 font-mono text-sm animate-pulse">Deeply analyzing {selectedLinks.length} pages...</p>
                                                <p className="text-xs text-gray-500 mt-2">{researchProgress || 'Initializing...'}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-white/5 flex gap-3 justify-end bg-[#0f0f0f] rounded-b-2xl">
                                {(researchStep === 'input') && (
                                    <button
                                        onClick={handleScan}
                                        disabled={!researchTarget?.website}
                                        className="px-6 py-2 bg-teal-500 text-black font-bold rounded-lg hover:bg-teal-400 transition-colors"
                                    >
                                        Scan Website
                                    </button>
                                )}

                                {(researchStep === 'selecting') && (
                                    <button
                                        onClick={handleAnalyze}
                                        disabled={selectedLinks.length === 0}
                                        className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${selectedLinks.length === 0 ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-teal-500 text-black hover:bg-teal-400'
                                            }`}
                                    >
                                        Analyze Selected Pages
                                    </button>
                                )}

                                {researchStep === 'result' && (
                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleUpdateProfile}
                                            className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                        >
                                            💾 Update Profile
                                        </button>
                                        <button
                                            onClick={handleRegenerateOutreach}
                                            className="px-4 py-2 bg-teal-500/20 text-teal-400 border border-teal-500/50 hover:bg-teal-500/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                        >
                                            ↻ Regenerate Outreach
                                        </button>
                                        <button
                                            onClick={() => setResearchModalOpen(false)}
                                            className="px-6 py-2 bg-white/10 text-white font-bold rounded-lg hover:bg-white/20 transition-colors"
                                        >
                                            Done
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Add Company Modal */}
            <AddCompanyModal
                isOpen={addCompanyModalOpen}
                onClose={() => setAddCompanyModalOpen(false)}
                onComplete={() => {
                    setAddCompanyModalOpen(false);
                    loadCompanies(); // Refresh companies list
                }}
            />
        </div>
    )
}

export default Companies;
