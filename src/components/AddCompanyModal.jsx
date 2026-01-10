import { useState } from 'react';
import { X, Loader2, Globe, User, Users, Search, Check, AlertCircle, Linkedin, Mail, ChevronRight, Star, UserPlus } from 'lucide-react';

/**
 * AddCompanyModal - Multi-step modal for manual company research
 * Steps:
 * 1. Input - Enter URL and optional research focus
 * 2. Researching - Loading state while scraping
 * 3. Team Selection - Show discovered team members, select for enrichment
 * 4. Enrichment - Run Google search for LinkedIn/email
 * 5. Result - Show final results with conversion option
 */
export default function AddCompanyModal({ isOpen, onClose, onComplete }) {
    const [step, setStep] = useState('input'); // input, researching, team, enriching, result
    const [url, setUrl] = useState('');
    const [researchTopic, setResearchTopic] = useState('');
    const [error, setError] = useState('');

    // Research results
    const [company, setCompany] = useState(null);
    const [teamMembers, setTeamMembers] = useState([]);
    const [selectedMembers, setSelectedMembers] = useState([]);

    // Enrichment results
    const [enrichmentResults, setEnrichmentResults] = useState([]);
    const [enrichmentProgress, setEnrichmentProgress] = useState({ current: 0, total: 0 });

    // Manual add state
    const [showManualAdd, setShowManualAdd] = useState(false);
    const [manualName, setManualName] = useState('');
    const [manualTitle, setManualTitle] = useState('');
    const [progress, setProgress] = useState(''); // New progress state

    const handleStartResearch = async () => {
        if (!url.trim()) {
            setError('Please enter a company URL');
            return;
        }

        setError('');
        setStep('researching');

        try {
            const response = await fetch('/api/companies/add-manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ url, researchTopic })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Research failed');
            }

            // Stream reading
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
                                setProgress(data.message);
                            } else if (data.type === 'complete') {
                                setCompany(data.data.company);
                                setTeamMembers(data.data.teamMembers || []);

                                // Auto-select decision makers
                                const decisionMakers = (data.data.teamMembers || [])
                                    .filter(m => m.is_decision_maker || m.isDecisionMaker)
                                    .map(m => m.id || m.name);
                                setSelectedMembers(decisionMakers);

                                setStep('team');
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
            console.error('Research error:', e);
            setError(e.message);
            setStep('input');
        }
    };

    const handleEnrichSelected = async () => {
        if (selectedMembers.length === 0) {
            setError('Please select at least one team member');
            return;
        }

        setError('');
        setStep('enriching');
        setEnrichmentProgress({ current: 0, total: selectedMembers.length });

        try {
            // Get IDs of selected members (some may be temp IDs if not saved)
            const memberIds = teamMembers
                .filter(m => selectedMembers.includes(m.id || m.name))
                .filter(m => m.id) // Only include saved members
                .map(m => m.id);

            if (memberIds.length === 0) {
                // No saved members, need to save first (edge case)
                setError('Members not saved to database. Try adding the company again.');
                setStep('team');
                return;
            }

            const response = await fetch('/api/companies/team/enrich-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ memberIds })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Enrichment failed');
            }

            const data = await response.json();
            setEnrichmentResults(data.results || []);
            setStep('result');
        } catch (e) {
            console.error('Enrichment error:', e);
            setError(e.message);
            setStep('team');
        }
    };

    const handleConvertToLead = async (memberId) => {
        try {
            const response = await fetch(`/api/companies/team/${memberId}/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });

            if (!response.ok) {
                throw new Error('Failed to convert to lead');
            }

            // Update local state
            setEnrichmentResults(prev =>
                prev.map(r => r.id === memberId ? { ...r, converted: true } : r)
            );
        } catch (e) {
            console.error('Convert error:', e);
            setError(e.message);
        }
    };

    const handleAddManualMember = async () => {
        if (!manualName.trim()) {
            setError('Name is required');
            return;
        }

        try {
            const domain = company?.domain || url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

            const response = await fetch(`/api/companies/${domain}/team/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: manualName,
                    title: manualTitle,
                    companyName: company?.name
                })
            });

            if (!response.ok) {
                throw new Error('Failed to add team member');
            }

            const data = await response.json();
            setTeamMembers(prev => [...prev, data.member]);
            setManualName('');
            setManualTitle('');
            setShowManualAdd(false);
        } catch (e) {
            console.error('Add member error:', e);
            setError(e.message);
        }
    };

    const toggleMemberSelection = (id) => {
        setSelectedMembers(prev =>
            prev.includes(id)
                ? prev.filter(m => m !== id)
                : [...prev, id]
        );
    };

    const handleClose = () => {
        // Reset state
        setStep('input');
        setUrl('');
        setResearchTopic('');
        setError('');
        setCompany(null);
        setTeamMembers([]);
        setSelectedMembers([]);
        setEnrichmentResults([]);
        setShowManualAdd(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

            {/* Modal */}
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-teal-500/10 rounded-xl border border-teal-500/20">
                            <Globe className="w-5 h-5 text-teal-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Add Company</h2>
                            <p className="text-sm text-gray-500">
                                {step === 'input' && 'Enter a company URL to research'}
                                {step === 'researching' && 'Scanning website...'}
                                {step === 'team' && 'Select team members to enrich'}
                                {step === 'enriching' && 'Finding contact details...'}
                                {step === 'result' && 'Enrichment complete'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Step 1: Input */}
                    {step === 'input' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-2">
                                    Company Website URL
                                </label>
                                <input
                                    type="text"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="https://example.com"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-2">
                                    Research Focus (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={researchTopic}
                                    onChange={(e) => setResearchTopic(e.target.value)}
                                    placeholder="e.g., Find leadership team for real estate outreach"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all"
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Researching */}
                    {step === 'researching' && (
                        <div className="py-12 text-center">
                            <Loader2 className="w-12 h-12 text-teal-400 mx-auto mb-4 animate-spin" />
                            <p className="text-white font-semibold mb-2">Researching Company...</p>
                            <p className="text-sm text-gray-500">{progress || 'Scanning website and extracting team members'}</p>
                        </div>
                    )}

                    {/* Step 3: Team Selection */}
                    {step === 'team' && (
                        <div className="space-y-4">
                            {/* Company Info */}
                            {company && (
                                <div className="p-4 bg-teal-500/5 border border-teal-500/20 rounded-xl mb-6">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Check className="w-5 h-5 text-teal-400" />
                                        <span className="text-white font-semibold">{company.name}</span>
                                    </div>
                                    <p className="text-sm text-gray-400">{company.domain}</p>
                                </div>
                            )}

                            {/* Team List */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm uppercase tracking-wider text-gray-500 font-bold">
                                        Team Members Found ({teamMembers.length})
                                    </h3>
                                    <button
                                        onClick={() => setShowManualAdd(!showManualAdd)}
                                        className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300"
                                    >
                                        <UserPlus className="w-3 h-3" />
                                        Add Manually
                                    </button>
                                </div>

                                {/* Manual Add Form */}
                                {showManualAdd && (
                                    <div className="p-4 bg-white/5 border border-white/10 rounded-xl mb-4 space-y-3">
                                        <input
                                            type="text"
                                            value={manualName}
                                            onChange={(e) => setManualName(e.target.value)}
                                            placeholder="Full Name"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
                                        />
                                        <input
                                            type="text"
                                            value={manualTitle}
                                            onChange={(e) => setManualTitle(e.target.value)}
                                            placeholder="Job Title (optional)"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
                                        />
                                        <button
                                            onClick={handleAddManualMember}
                                            className="w-full py-2 bg-teal-500/20 text-teal-400 rounded-lg text-sm font-semibold hover:bg-teal-500/30 transition-colors"
                                        >
                                            Add Member
                                        </button>
                                    </div>
                                )}

                                {teamMembers.length === 0 ? (
                                    <div className="text-center py-8">
                                        <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                        <p className="text-gray-500 text-sm">No team members found on the website.</p>
                                        <p className="text-gray-600 text-xs mt-1">Use "Add Manually" to enter team members you find elsewhere.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {teamMembers.map((member, idx) => {
                                            const id = member.id || member.name;
                                            const isSelected = selectedMembers.includes(id);
                                            const isDecisionMaker = member.is_decision_maker || member.isDecisionMaker;

                                            return (
                                                <div
                                                    key={id || idx}
                                                    onClick={() => toggleMemberSelection(id)}
                                                    className={`
                                                        p-4 rounded-xl cursor-pointer transition-all flex items-center justify-between
                                                        ${isSelected
                                                            ? 'bg-teal-500/10 border border-teal-500/30'
                                                            : 'bg-white/5 border border-white/10 hover:bg-white/10'
                                                        }
                                                    `}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`
                                                            w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                                                            ${isSelected
                                                                ? 'bg-teal-500 border-teal-500'
                                                                : 'border-white/30'
                                                            }
                                                        `}>
                                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                                        </div>
                                                        <div>
                                                            <p className="text-white font-medium">{member.person_name || member.name}</p>
                                                            <p className="text-xs text-gray-500">{member.job_title || member.title || 'Unknown Role'}</p>
                                                        </div>
                                                    </div>
                                                    {isDecisionMaker && (
                                                        <div className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20">
                                                            <Star className="w-3 h-3" />
                                                            Recommended
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 4: Enriching */}
                    {step === 'enriching' && (
                        <div className="py-12 text-center">
                            <Loader2 className="w-12 h-12 text-teal-400 mx-auto mb-4 animate-spin" />
                            <p className="text-white font-semibold mb-2">Finding Contact Details...</p>
                            <p className="text-sm text-gray-500">
                                Searching Google for LinkedIn profiles and emails
                            </p>
                            {enrichmentProgress.total > 0 && (
                                <p className="text-xs text-gray-600 mt-2">
                                    {enrichmentProgress.current} / {enrichmentProgress.total}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Step 5: Results */}
                    {step === 'result' && (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                                <p className="text-green-400 font-semibold">
                                    Enrichment Complete! Found {enrichmentResults.filter(r => r.linkedin || r.email).length} contacts with details.
                                </p>
                            </div>

                            {enrichmentResults.map((result, idx) => (
                                <div
                                    key={result.id || idx}
                                    className="p-4 bg-white/5 border border-white/10 rounded-xl"
                                >
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="text-white font-semibold">{result.name}</p>
                                            <div className="flex items-center gap-4 mt-2">
                                                {result.linkedin ? (
                                                    <a
                                                        href={result.linkedin}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                                                    >
                                                        <Linkedin className="w-3 h-3" />
                                                        LinkedIn Found
                                                    </a>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs text-gray-500">
                                                        <Linkedin className="w-3 h-3" />
                                                        No LinkedIn
                                                    </span>
                                                )}
                                                {result.email ? (
                                                    <span className="flex items-center gap-1 text-xs text-green-400">
                                                        <Mail className="w-3 h-3" />
                                                        {result.email}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs text-gray-500">
                                                        <Mail className="w-3 h-3" />
                                                        No Email
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {result.converted ? (
                                            <span className="px-3 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                                                Saved as Lead
                                            </span>
                                        ) : result.linkedin ? (
                                            <button
                                                onClick={() => handleConvertToLead(result.id)}
                                                className="px-3 py-1 bg-teal-500/20 text-teal-400 text-xs rounded-lg hover:bg-teal-500/30 transition-colors"
                                            >
                                                Save as Lead
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 flex items-center justify-between">
                    <div>
                        {step !== 'input' && step !== 'researching' && step !== 'enriching' && (
                            <button
                                onClick={() => setStep(step === 'result' ? 'team' : 'input')}
                                className="text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                ← Back
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                        >
                            {step === 'result' ? 'Done' : 'Cancel'}
                        </button>

                        {step === 'input' && (
                            <button
                                onClick={handleStartResearch}
                                className="px-6 py-2 bg-teal-500 hover:bg-teal-400 text-white font-semibold rounded-xl flex items-center gap-2 transition-colors"
                            >
                                <Search className="w-4 h-4" />
                                Start Research
                            </button>
                        )}

                        {step === 'team' && (
                            <button
                                onClick={handleEnrichSelected}
                                disabled={selectedMembers.length === 0}
                                className={`
                                    px-6 py-2 font-semibold rounded-xl flex items-center gap-2 transition-colors
                                    ${selectedMembers.length > 0
                                        ? 'bg-teal-500 hover:bg-teal-400 text-white'
                                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                    }
                                `}
                            >
                                Enrich Selected ({selectedMembers.length})
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
