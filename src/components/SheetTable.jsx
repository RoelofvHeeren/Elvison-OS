import { useState } from 'react'
import PropTypes from 'prop-types'
import { Trash2, Building2, Search, RefreshCw } from 'lucide-react'

const columns = [
  { key: 'select', label: '', width: 'w-16' },
  { key: 'index', label: '#', width: 'w-12' },
  { key: 'date', label: 'Date Added', width: 'w-28' },
  { key: 'name', label: 'Name', width: 'w-40' },
  { key: 'title', label: 'Title', width: 'w-56' },
  { key: 'company', label: 'Company', width: 'w-44' },
  { key: 'email', label: 'Email', width: 'w-56' },
  { key: 'phone', label: 'Phone', width: 'w-40' },
  { key: 'linkedin', label: 'LinkedIn', width: 'w-24' },
  { key: 'website', label: 'Website', width: 'w-24' },
  { key: 'connectionRequest', label: 'Connection Request', width: 'min-w-[20rem]' },
  { key: 'emailMessage', label: 'Email Message', width: 'min-w-[20rem]' },
  { key: 'companyProfile', label: 'Company Profile', width: 'min-w-[24rem]' },
  { key: 'status', label: 'Status', width: 'w-24' },
  { key: 'reason', label: 'Reason', width: 'w-48' },
  { key: 'researchFact', label: 'Research Fact', width: 'w-64' },
  { key: 'actions', label: '', width: 'w-10' },
]

const SheetTable = ({ rows, loading, error, onDeleteRow, onEnrichRow, onDeepEnrichRow, onRegenerateRow, selectedLeads, onToggleSelection, onToggleSelectAll, selectAll }) => {
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')

  const handleCellClick = (rowIdx, colKey, value) => {
    setEditingCell({ rowIdx, colKey })
    setEditValue(value || '')
  }

  const handleCellBlur = () => {
    setEditingCell(null)
  }

  const formatWebsiteUrl = (url) => {
    if (!url) return null
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    return `https://${url}`
  }

  const renderFormattedText = (text) => {
    if (!text) return '—'
    const formatted = (text || '')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
      .replace(/\n/g, '<br />')

    return <div dangerouslySetInnerHTML={{ __html: formatted }} />
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-300 shadow-lg">
        {error}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden transition-all duration-300 shadow-xl w-full">
      <div className="max-h-[65vh] overflow-auto w-full">
        <table className="min-w-full divide-y divide-white/10 text-left">
          <thead className="bg-black/40 sticky top-0 z-10 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400 border-b border-white/10">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 ${col.width}`}>
                  {col.key === 'select' ? (
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={onToggleSelectAll}
                      className="w-4 h-4 rounded border-gray-600 bg-black/20 text-teal-500 focus:ring-teal-500 cursor-pointer"
                    />
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-400">
                  Fetching leads from Sheets…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-400">
                  No leads found yet. Kick off a new job to fill the sheet.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={`${row.id}-${idx}`}
                  className="transition-all duration-200 hover:bg-white/5 group"
                >
                  {/* Select */}
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={selectedLeads?.has(row.id) || false}
                      onChange={() => onToggleSelection(row.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-black/20 text-teal-500 focus:ring-teal-500 cursor-pointer"
                    />
                  </td>

                  {/* Index */}
                  <td className="px-4 py-3.5 text-xs text-gray-500 font-mono">{row.originalIndex || (idx + 1)}</td>

                  {/* Date */}
                  <td className="px-4 py-3.5 text-xs font-medium text-gray-400">{row.date || '—'}</td>

                  {/* Name */}
                  <td
                    className="px-4 py-3.5 text-sm font-semibold text-white tracking-tight cursor-text"
                    onClick={() => handleCellClick(idx, 'name', row.name)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'name' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-sm text-white"
                      />
                    ) : (
                      row.name || '—'
                    )}
                  </td>

                  {/* Title */}
                  <td className="px-4 py-3.5 text-xs text-gray-400 truncate max-w-[12rem]">{row.title || '—'}</td>

                  {/* Company */}
                  <td className="px-4 py-3.5 text-xs font-bold text-gray-300">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3 h-3 text-teal-500/50" />
                      {row.company || '—'}
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="text-teal-400 hover:text-teal-300 hover:underline underline-offset-4 transition-colors font-medium"
                      >
                        {row.email}
                      </a>
                    ) : ('—')}
                  </td>

                  {/* Phone */}
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {row.phoneNumbers && row.phoneNumbers.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {row.phoneNumbers.map((p, pIdx) => (
                          <span key={pIdx} className="block font-mono text-[10px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded w-fit">
                            {p.sanitized_number} ({p.type})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onEnrichRow) onEnrichRow(row.id)
                        }}
                        className="text-[10px] font-bold text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 px-2 py-1 rounded border border-teal-500/20 transition-colors"
                      >
                        Reveal Phone
                      </button>
                    )}
                  </td>

                  {/* LinkedIn */}
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {row.linkedin ? (
                      <a href={row.linkedin} target="_blank" rel="noreferrer" className="text-teal-400 hover:text-teal-300 underline underline-offset-4">
                        Profile
                      </a>
                    ) : '—'}
                  </td>

                  {/* Website */}
                  <td className="px-4 py-3 text-gray-400 text-xs text-center">
                    {row.website ? (
                      <a href={formatWebsiteUrl(row.website)} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-teal-400 transition-colors">
                        Visit
                      </a>
                    ) : '—'}
                  </td>

                  {/* Connection Request */}
                  <td
                    className="px-4 py-3.5 text-xs text-gray-400 cursor-text"
                    onClick={() => handleCellClick(idx, 'connectionRequest', row.connectionRequest)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'connectionRequest' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-xs text-white resize-none"
                      />
                    ) : (
                      <div className="max-w-xs line-clamp-3 text-[11px] text-gray-300 leading-relaxed">
                        {renderFormattedText(row.connectionRequest)}
                      </div>
                    )}
                  </td>

                  {/* Email Message */}
                  <td
                    className="px-4 py-3.5 text-xs text-gray-400 cursor-text"
                    onClick={() => handleCellClick(idx, 'emailMessage', row.emailMessage)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'emailMessage' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-xs text-white resize-none"
                      />
                    ) : (
                      <div className="max-w-xs line-clamp-3 text-[11px] text-gray-300 leading-relaxed">
                        {renderFormattedText(row.emailMessage)}
                      </div>
                    )}
                  </td>

                  {/* Company Profile */}
                  <td
                    className="px-4 py-3.5 text-xs text-gray-400 cursor-text"
                    onClick={() => handleCellClick(idx, 'companyProfile', row.companyProfile)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'companyProfile' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-xs text-white resize-none"
                      />
                    ) : (
                      <div className="max-w-md line-clamp-4 text-[11px] text-gray-300 leading-relaxed">
                        {renderFormattedText(row.companyProfile)}
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm ${row.status === 'SUCCESS' ? 'bg-teal-500/20 text-teal-400 border-teal-500/30' :
                      row.status === 'SKIP' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
                        row.status === 'NEEDS_RESEARCH' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                          'bg-gray-500/20 text-gray-400 border-gray-500/30'
                      }`}>
                      {row.status}
                    </span>
                  </td>

                  {/* Reason */}
                  <td className="px-4 py-3.5 text-[11px] text-gray-400 max-w-[12rem] truncate" title={row.reason}>
                    {row.reason || '—'}
                  </td>

                  {/* Research Fact */}
                  <td className="px-4 py-3.5">
                    {row.researchFact ? (
                      <div className="max-w-[16rem] italic text-[11px] text-gray-300 leading-snug truncate" title={row.researchFact}>
                        "{row.researchFact}"
                      </div>
                    ) : (
                      <span className="text-gray-600 text-[11px]">No fact found</span>
                    )}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3 text-gray-400">
                    <div className="flex items-center gap-2">
                      {row.status === 'SKIP' && (
                        <button
                          onClick={() => onDeepEnrichRow(row.id)}
                          className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-all"
                          title="Deep Research"
                        >
                          <Search className="w-4 h-4" />
                        </button>
                      )}
                      {row.status === 'NEEDS_RESEARCH' && (
                        <button
                          onClick={() => onRegenerateRow(row.id)}
                          className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all"
                          title="Regenerate Outreach"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      {row.status === 'MANUAL_REVIEW' && (
                        <button
                          onClick={() => onReviewRow(row)}
                          className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-all font-bold text-xs"
                          title="Review Lead"
                        >
                          Review
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onDeleteRow) onDeleteRow(row.id)
                        }}
                        className="p-1.5 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                        title="Delete Lead"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div >
    </div >
  )
}

SheetTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.any),
  loading: PropTypes.bool,
  error: PropTypes.string,
  onDeleteRow: PropTypes.func,
  onEnrichRow: PropTypes.func,
  onDeepEnrichRow: PropTypes.func,
  onRegenerateRow: PropTypes.func,
  onReviewRow: PropTypes.func,
  selectedLeads: PropTypes.any,
  onToggleSelection: PropTypes.func,
  onToggleSelectAll: PropTypes.func,
  selectAll: PropTypes.bool,
}

export default SheetTable
