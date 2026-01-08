import { useEffect, useState } from 'react'
import { Building2, ChevronDown, ChevronUp, Trash2, Users } from 'lucide-react'
import { fetchLeads, deleteLead } from '../utils/api'
import { useIcp } from '../context/IcpContext'

function Companies() {
    const [companies, setCompanies] = useState([])
    const [loading, setLoading] = useState(true)
    const [expandedCompany, setExpandedCompany] = useState(null)
    const [filters, setFilters] = useState({ icpId: '' })

    const { icps, fetchIcps } = useIcp()

    useEffect(() => {
        loadCompanies()
        fetchIcps()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.icpId])

    const loadCompanies = async () => {
        setLoading(true)
        try {
            // Fetch ALL leads - request large page size to get everything
            const params = { pageSize: 1000 } // Request up to 1000 leads
            if (filters.icpId) params.icpId = filters.icpId

            const response = await fetchLeads(params)

            // Handle both array and paginated response
            let allLeads = []
            if (Array.isArray(response)) {
                allLeads = response
            } else if (response?.data) {
                allLeads = response.data

                // If there are more pages, fetch them
                if (response.pagination?.totalPages > 1) {
                    const totalPages = response.pagination.totalPages
                    const pagePromises = []

                    for (let page = 2; page <= totalPages; page++) {
                        pagePromises.push(fetchLeads({ ...params, page }))
                    }

                    const results = await Promise.all(pagePromises)
                    results.forEach(result => {
                        const pageData = Array.isArray(result) ? result : (result?.data || [])
                        allLeads.push(...pageData)
                    })
                }
            }

            // Group leads by company
            const companyMap = new Map()

            allLeads.forEach(lead => {
                let companyName = lead.company_name || 'Unknown Company'

                // Parse custom_data safely
                let customData = {}
                if (lead.custom_data) {
                    try {
                        customData = typeof lead.custom_data === 'string'
                            ? JSON.parse(lead.custom_data)
                            : lead.custom_data
                    } catch (e) {
                        console.error('Error parsing custom_data', e)
                    }
                }

                const companyWebsite = customData.company_website || customData.company_domain || ''
                // Normalize domain for deduplication
                const rawDomain = companyWebsite.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].toLowerCase()

                // DEDUPLICATION LOGIC:
                // Use normalized domain as the primary key if available, otherwise name
                const dedupKey = rawDomain || companyName.toLowerCase().replace(/[^a-z0-9]/g, '')

                if (!companyMap.has(dedupKey)) {
                    // Extract fit score from multiple possible keys
                    let fitScore = customData.score || customData.fit_score || customData.match_score || 'N/A'

                    // If it's a number like 0.85, multiply by 10 and round
                    if (typeof fitScore === 'number' && fitScore <= 1) {
                        fitScore = Math.round(fitScore * 10)
                    }

                    companyMap.set(dedupKey, {
                        name: companyName, // Use the first encounter name
                        website: companyWebsite,
                        profile: customData.company_profile || '',
                        fitScore: fitScore,
                        leads: [],
                        leadCount: 0,
                        domain: rawDomain
                    })
                }

                const entry = companyMap.get(dedupKey)

                // Prefer shorter/cleaner names for the primary display
                if (companyName.length < entry.name.length && companyName.length > 3) {
                    entry.name = companyName
                }

                entry.leads.push({
                    id: lead.id,
                    personName: lead.person_name,
                    jobTitle: lead.job_title,
                    email: lead.email,
                    linkedinUrl: lead.linkedin_url
                })
            })

            // Convert to array and calculate lead counts
            const companiesArray = Array.from(companyMap.values()).map(company => ({
                ...company,
                leadCount: company.leads.length
            }))

            // Sort by lead count descending
            companiesArray.sort((a, b) => b.leadCount - a.leadCount)

            setCompanies(companiesArray)
        } catch (error) {
            console.error('Failed to load companies:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleDeleteCompany = async (companyName) => {
        if (!window.confirm(`Delete all leads from "${companyName}"? This cannot be undone.`)) {
            return
        }

        const company = companies.find(c => c.name === companyName)
        if (!company) return

        try {
            // Delete all leads for this company
            await Promise.all(company.leads.map(lead => deleteLead(lead.id)))

            // Reload companies
            await loadCompanies()
        } catch (error) {
            console.error('Failed to delete company leads:', error)
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

    const parseProfileIntoSections = (profile) => {
        if (!profile) return {};
        const sections = {};

        const lines = profile.split('\n');
        let currentSection = 'General Overview';
        let currentContent = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            // Header Patterns:
            // 1. Markdown: # Title or ## Title
            // 2. Bold numbered: **1. Title:** or **Title:**
            // 3. Numbered: 1. Title: 
            // 4. CAPS title: SUMMARY: or STRATEGY:
            const markdownMatch = trimmed.match(/^#+\s+(.*)$/);
            const boldMatch = trimmed.match(/^\*\*(?:\d+\.\s+)?(.*?):?\s*\*\*$/) || trimmed.match(/^\*\*(.*?)\*\*$/);
            const colonMatch = trimmed.match(/^(\d+\.\s+)?([A-Z][\w\s&/]{2,40}):\s*$/);
            const capsMatch = trimmed.match(/^([A-Z\s]{4,30}):\s*$/);

            const headerTitle = (markdownMatch?.[1] || boldMatch?.[1] || colonMatch?.[2] || capsMatch?.[1])?.trim();

            // If it's a short title-like line and we found a match, treat as new section
            if (headerTitle && headerTitle.length < 60) {
                if (currentContent.length > 0) {
                    sections[currentSection] = currentContent.join('\n').trim();
                }
                currentSection = headerTitle.replace(/[*#:]/g, '').trim();
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        });

        if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
        }

        // Cleanup: If "General Overview" is empty and we have others, delete it
        if (sections['General Overview'] === '' && Object.keys(sections).length > 1) {
            delete sections['General Overview'];
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

                {/* ICP Filter */}
                {icps.length > 0 && (
                    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-4">
                        <label className="text-xs uppercase tracking-wider font-semibold text-gray-400 mb-2 block">
                            Filter by ICP
                        </label>
                        <select
                            value={filters.icpId}
                            onChange={(e) => setFilters({ icpId: e.target.value })}
                            className="w-full md:w-64 bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-[#139187] focus:ring-2 focus:ring-[#139187]/20 transition-all"
                        >
                            <option value="">All ICPs</option>
                            {icps.map(icp => (
                                <option key={icp.id} value={icp.id}>{icp.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Companies List */}
                {loading ? (
                    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-12 text-center">
                        <p className="text-gray-400">Loading companies...</p>
                    </div>
                ) : companies.length === 0 ? (
                    <div className="bg-gray-800/50 backdrop-blur-md border border-gray-700/50 rounded-2xl px-6 py-12 text-center">
                        <Building2 className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-white font-medium">No companies found</p>
                        <p className="text-sm text-gray-400 mt-1">Start generating leads to see companies here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {companies.map((company) => (
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
                                                handleDeleteCompany(company.name)
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
                                            </div>

                                            {company.profile ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                    {(() => {
                                                        const sections = parseProfileIntoSections(company.profile);
                                                        const defaultIcons = {
                                                            'Summary': <Building2 className="w-4 h-4 text-teal-400" />,
                                                            'General Overview': <Building2 className="w-4 h-4 text-teal-400" />,
                                                            'Investment Strategy': <Users className="w-4 h-4 text-purple-400" />,
                                                            'Scale & Geographic Focus': <Users className="w-4 h-4 text-orange-400" />,
                                                            'Portfolio Observations': <Building2 className="w-4 h-4 text-blue-400" />,
                                                            'Key Highlights': <ChevronDown className="w-4 h-4 text-yellow-400" />
                                                        };

                                                        return Object.entries(sections).map(([title, content]) => (
                                                            <div key={title} className={title === 'Summary' || title === 'Key Highlights' || title === 'General Overview' ? 'col-span-1 md:col-span-2' : ''}>
                                                                {renderReportSection(title, content, defaultIcons[title] || <Building2 className="w-4 h-4 text-teal-400" />)}
                                                            </div>
                                                        ));
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
        </div>
    )
}

export default Companies
