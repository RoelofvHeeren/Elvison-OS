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
            // Fetch all leads (respecting ICP filter)
            const params = {}
            if (filters.icpId) params.icpId = filters.icpId

            const response = await fetchLeads(params)
            const leads = Array.isArray(response) ? response : (response?.data || [])

            // Group leads by company
            const companyMap = new Map()

            leads.forEach(lead => {
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
        <div className="space-y-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {/* Header */}
            <div className="glass-panel p-6 bg-white/5 border border-white/10 backdrop-blur-md">
                <div className="flex items-center gap-3 mb-2">
                    <Building2 className="h-8 w-8 text-teal-400" />
                    <h1 className="font-serif text-3xl font-bold text-white">Companies</h1>
                </div>
                <p className="text-sm text-gray-400">
                    Review all companies with leads, view company profiles, and clean up bad data.
                </p>
            </div>

            {/* Stats */}
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="glass-panel flex items-center gap-4 px-5 py-4">
                    <Building2 className="h-11 w-11 rounded-xl bg-primary/10 p-2.5 text-primary border border-primary/20" />
                    <div>
                        <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Total Companies</p>
                        <p className="font-serif text-2xl font-bold text-accent">{companies.length}</p>
                    </div>
                </div>
                <div className="glass-panel flex items-center gap-4 px-5 py-4">
                    <Users className="h-11 w-11 rounded-xl bg-primary/10 p-2.5 text-primary border border-primary/20" />
                    <div>
                        <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Total Leads</p>
                        <p className="font-serif text-2xl font-bold text-accent">
                            {companies.reduce((sum, c) => sum + c.leadCount, 0)}
                        </p>
                    </div>
                </div>
                <div className="glass-panel flex items-center gap-4 px-5 py-4">
                    <Building2 className="h-11 w-11 rounded-xl bg-primary/10 p-2.5 text-primary border border-primary/20" />
                    <div>
                        <p className="text-xs uppercase tracking-[0.25em] font-bold text-primary">Avg Leads/Company</p>
                        <p className="font-serif text-2xl font-bold text-accent">
                            {companies.length > 0
                                ? (companies.reduce((sum, c) => sum + c.leadCount, 0) / companies.length).toFixed(1)
                                : '0'}
                        </p>
                    </div>
                </div>
            </div>

            {/* ICP Filter */}
            <div className="glass-panel px-5 py-5">
                <div className="flex flex-col gap-1 max-w-md">
                    <label htmlFor="icp" className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted flex items-center gap-2">
                        Filter by Strategy
                    </label>
                    <select
                        id="icp"
                        value={filters.icpId}
                        onChange={(e) => setFilters({ icpId: e.target.value })}
                        className="w-full rounded-2xl border border-outline/80 bg-white/80 px-3 py-2.5 text-sm text-ink outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/10"
                    >
                        <option value="">All Strategies</option>
                        {icps.map(icp => (
                            <option key={icp.id} value={icp.id}>{icp.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Companies List */}
            <div className="glass-panel overflow-hidden">
                {loading ? (
                    <div className="px-6 py-12 text-center text-muted">Loading companies...</div>
                ) : companies.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                        <Building2 className="h-12 w-12 text-muted/50 mx-auto mb-3" />
                        <p className="text-muted font-medium">No companies found</p>
                        <p className="text-sm text-muted/70 mt-1">Start generating leads to see companies here.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-glass-border">
                        {companies.map((company) => (
                            <div key={company.name} className="bg-white">
                                {/* Company Header */}
                                <div
                                    className="px-6 py-4 hover:bg-surface/30 transition-colors cursor-pointer flex items-center justify-between"
                                    onClick={() => toggleCompanyExpand(company.name)}
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <Building2 className="h-5 w-5 text-primary" />
                                        <div>
                                            <h3 className="font-semibold text-accent">{company.name}</h3>
                                            {company.website && (
                                                <a
                                                    href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-xs text-primary hover:underline"
                                                >
                                                    {company.website}
                                                </a>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-muted">
                                            <span className="font-semibold text-accent">{company.leadCount}</span> leads
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDeleteCompany(company.name)
                                            }}
                                            className="text-muted/50 hover:text-rose-500 transition-colors p-2"
                                            title="Delete all leads from this company"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                        {expandedCompany === company.name ? (
                                            <ChevronUp className="h-5 w-5 text-muted" />
                                        ) : (
                                            <ChevronDown className="h-5 w-5 text-muted" />
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {expandedCompany === company.name && (
                                    <div className="px-6 pb-6 bg-surface/10">
                                        {/* Company Profile */}
                                        {company.profile && (
                                            <div className="mb-4 p-4 bg-white rounded-lg border border-glass-border">
                                                <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-muted mb-2">
                                                    Company Profile
                                                </h4>
                                                <p className="text-sm text-muted leading-relaxed">{company.profile}</p>
                                            </div>
                                        )}

                                        {/* Leads Table */}
                                        <div className="bg-white rounded-lg border border-glass-border overflow-hidden">
                                            <table className="w-full text-sm">
                                                <thead className="bg-surface/20 text-xs font-bold uppercase tracking-[0.15em] text-muted">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left">Name</th>
                                                        <th className="px-4 py-3 text-left">Title</th>
                                                        <th className="px-4 py-3 text-left">Email</th>
                                                        <th className="px-4 py-3 text-left">LinkedIn</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-glass-border">
                                                    {company.leads.map((lead) => (
                                                        <tr key={lead.id} className="hover:bg-surface/20 transition-colors">
                                                            <td className="px-4 py-3 font-medium text-accent">{lead.personName}</td>
                                                            <td className="px-4 py-3 text-muted">{lead.jobTitle || '—'}</td>
                                                            <td className="px-4 py-3">
                                                                {lead.email ? (
                                                                    <a
                                                                        href={`mailto:${lead.email}`}
                                                                        className="text-primary hover:underline"
                                                                    >
                                                                        {lead.email}
                                                                    </a>
                                                                ) : '—'}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {lead.linkedinUrl ? (
                                                                    <a
                                                                        href={lead.linkedinUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="text-primary hover:underline"
                                                                    >
                                                                        View
                                                                    </a>
                                                                ) : '—'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
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
