import { useState } from 'react'
import PropTypes from 'prop-types'
import { Trash2 } from 'lucide-react'

const columns = [
  { key: 'select', label: '', width: 'w-12' },
  { key: 'index', label: '#', width: 'w-12' },
  { key: 'date', label: 'Date Added', width: 'w-28' },
  { key: 'name', label: 'Name', width: 'w-40' },
  { key: 'title', label: 'Title', width: 'w-56' },
  { key: 'company', label: 'Company', width: 'w-44' },
  { key: 'email', label: 'Email', width: 'w-56' },
  { key: 'phone', label: 'Phone', width: 'w-40' },
  { key: 'linkedin', label: 'LinkedIn', width: 'w-24' },

  { key: 'website', label: 'Company Website', width: 'w-28' },
  { key: 'connectionRequest', label: 'Connection Request', width: 'min-w-[20rem]' },
  { key: 'emailMessage', label: 'Email Message', width: 'min-w-[20rem]' },
  { key: 'companyProfile', label: 'Company Profile', width: 'min-w-[24rem]' },
  { key: 'actions', label: '', width: 'w-10' },
]

const SheetTable = ({ rows, loading, error, onDeleteRow, onEnrichRow, selectedLeads, onToggleSelection, onToggleSelectAll, selectAll }) => {
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')

  const handleCellClick = (rowIdx, colKey, value) => {
    setEditingCell({ rowIdx, colKey })
    setEditValue(value || '')
  }

  const handleCellBlur = () => {
    // Here you would save the edited value to the backend
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
                  key={`${row.email}-${idx}`}
                  className="transition-all duration-200 hover:bg-white/5 group"
                >
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={selectedLeads?.has(row.id) || false}
                      onChange={() => onToggleSelection(row.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-black/20 text-teal-500 focus:ring-teal-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500 font-mono">{row.originalIndex || (idx + 1)}</td>
                  <td className="px-4 py-3.5 text-xs font-medium text-gray-400">{row.date || '—'}</td>
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
                  <td
                    className="px-4 py-3.5 text-xs text-gray-400 cursor-text"
                    onClick={() => handleCellClick(idx, 'title', row.title)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'title' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-xs text-white"
                      />
                    ) : (
                      row.title || '—'
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-gray-400 cursor-text"
                    onClick={() => handleCellClick(idx, 'company', row.company)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'company' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-black/40 border border-teal-500 rounded px-2 py-1 text-xs text-white"
                      />
                    ) : (
                      row.company || '—'
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="text-teal-400 hover:text-teal-300 hover:underline underline-offset-4 transition-colors font-medium"
                      >
                        {row.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {row.phoneNumbers && row.phoneNumbers.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {row.phoneNumbers.map((p, idx) => (
                          <span key={idx} className="block font-mono text-[10px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded w-fit">
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
                  <td className="px-4 py-3 text-gray-400">
                    {row.linkedin ? (
                      <a
                        href={row.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal-400 underline decoration-teal-500 decoration-2 underline-offset-2 hover:text-teal-300 transition-colors"
                      >
                        Profile
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {row.website ? (
                      <a
                        href={formatWebsiteUrl(row.website)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal-400 underline decoration-teal-500 decoration-2 underline-offset-2 hover:text-teal-300 transition-colors"
                      >
                        Visit
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
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
                      <div className="relative group/cell cursor-pointer">
                        <div className="max-w-xs line-clamp-3 text-[11px] leading-relaxed text-gray-300">
                          {renderFormattedText(row.connectionRequest)}
                        </div>
                        {row.connectionRequest?.length > 50 && (
                          <span className="text-[10px] text-teal-400 font-bold opacity-0 group-hover/cell:opacity-100 transition-opacity absolute -bottom-1 right-0 bg-black/80 px-1 shadow-sm border border-white/10 rounded">
                            Click to edit
                          </span>
                        )}
                      </div>
                    )}
                  </td>
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
                      <div className="relative group/cell cursor-pointer">
                        <div className="max-w-xs line-clamp-3 text-[11px] leading-relaxed text-gray-300">
                          {renderFormattedText(row.emailMessage)}
                        </div>
                        {row.emailMessage?.length > 50 && (
                          <span className="text-[10px] text-teal-400 font-bold opacity-0 group-hover/cell:opacity-100 transition-opacity absolute -bottom-1 right-0 bg-black/80 px-1 shadow-sm border border-white/10 rounded">
                            Click to edit
                          </span>
                        )}
                      </div>
                    )}
                  </td>
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
                      <div className="relative group/cell cursor-pointer">
                        <div className="max-w-md line-clamp-4 text-[11px] leading-relaxed text-gray-300">
                          {renderFormattedText(row.companyProfile)}
                        </div>
                        {row.companyProfile?.length > 60 && (
                          <span className="text-[10px] text-teal-400 font-bold opacity-0 group-hover/cell:opacity-100 transition-opacity absolute -bottom-1 right-0 bg-black/80 px-1 shadow-sm border border-white/10 rounded">
                            Click to edit
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onDeleteRow) onDeleteRow(row.id)
                      }}
                      className="text-gray-500 hover:text-rose-400 transition-colors p-1"
                      title="Delete Lead"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table >
      </div >
    </div >
  )
}

SheetTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      originalIndex: PropTypes.number,
      date: PropTypes.string,
      name: PropTypes.string,
      title: PropTypes.string,
      company: PropTypes.string,
      email: PropTypes.string,
      linkedin: PropTypes.string,
      website: PropTypes.string,
      connectionRequest: PropTypes.string,
      emailMessage: PropTypes.string,
      companyProfile: PropTypes.string,
    }),
  ),
  loading: PropTypes.bool,
  error: PropTypes.string,
  onDeleteRow: PropTypes.func,
  onEnrichRow: PropTypes.func,
}

SheetTable.defaultProps = {
  rows: [],
  loading: false,
  error: '',
}

export default SheetTable
