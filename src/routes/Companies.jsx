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
                const companyName = lead.company_name || 'Unknown Company'

                if (!companyMap.has(companyName)) {
                    // Parse company profile from custom_data
                    let companyProfile = ''
                    let companyWebsite = ''

                    if (lead.custom_data) {
                        try {
                            const customData = typeof lead.custom_data === 'string'
                                ? JSON.parse(lead.custom_data)
                                : lead.custom_data
                            companyProfile = customData.company_profile || ''
                            companyWebsite = customData.company_website || ''
                        } catch (e) {
                            console.error('Error parsing custom_data', e)
                        }
                    }

                    companyMap.set(companyName, {
                        name: companyName,
                        website: companyWebsite,
                        profile: companyProfile,
                        leads: [],
                        leadCount: 0
                    })
                }

                companyMap.get(companyName).leads.push({
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
                            Filter by Strategy
                        </label>
                        <select
                            value={filters.icpId}
                            onChange={(e) => setFilters({ icpId: e.target.value })}
                            className="w-full md:w-64 bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-[#139187] focus:ring-2 focus:ring-[#139187]/20 transition-all"
                        >
                            <option value="">All Strategies</option>
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
                                        <span className="text-gray-400 text-sm">
                                            <span className="text-white font-semibold">{company.leadCount}</span> leads
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDeleteCompany(company.name)
                                            }}
                                            className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors text-sm border border-rose-500/20"
                                            title="Delete all leads from this company"
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </button>
                                        {expandedCompany === company.name ? (
                                            <ChevronUp className="h-5 w-5 text-gray-400" />
                                        ) : (
                                            <ChevronDown className="h-5 w-5 text-gray-400" />
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {expandedCompany === company.name && (
                                    <div className="border-t border-white/5 p-6 bg-black/20">
                                        {/* Company Profile */}
                                        {company.profile && (
                                            <div className="mt-4 mb-6 p-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
                                                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                                                    Company Profile
                                                </h4>
                                                <p className="text-sm text-gray-300 leading-relaxed">{company.profile}</p>
                                            </div>
                                        )}

                                        {/* Leads */}
                                        <div className="space-y-3">
                                            {company.leads.map((lead) => {
                                                const initials = lead.personName?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?'
                                                return (
                                                    <div key={lead.id} className="flex items-center gap-4 p-4 bg-black/20 border border-white/10 rounded-xl hover:border-[#139187]/30 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <div className="flex-shrink-0">
                                                                <div className="w-10 h-10 rounded-full bg-[#139187]/10 border border-[#139187]/20 flex items-center justify-center flex-shrink-0">
                                                                    <span className="text-teal-400 font-semibold text-sm">{initials}</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <h4 className="font-semibold text-white">{lead.personName}</h4>
                                                                <span className="text-sm font-bold text-[#139187]">{lead.jobTitle || 'No title'}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                {lead.email && (
                                                                    <a
                                                                        href={`mailto:${lead.email}`}
                                                                        className="text-teal-400 hover:text-teal-300 text-sm font-medium"
                                                                    >
                                                                        Email
                                                                    </a>
                                                                )}
                                                                {lead.linkedinUrl && (
                                                                    <a
                                                                        href={lead.linkedinUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="text-teal-400 hover:text-teal-300 text-sm font-medium"
                                                                    >
                                                                        LinkedIn
                                                                    </a>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
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
