import { useState } from 'react'
import PropTypes from 'prop-types'

const columns = [
  { key: 'date', label: 'Date Added', width: 'w-28' },
  { key: 'name', label: 'Name', width: 'w-40' },
  { key: 'title', label: 'Title', width: 'w-56' },
  { key: 'company', label: 'Company', width: 'w-44' },
  { key: 'email', label: 'Email', width: 'w-56' },
  { key: 'linkedin', label: 'LinkedIn', width: 'w-24' },
  { key: 'website', label: 'Company Website', width: 'w-28' },
  { key: 'connectionRequest', label: 'Connection Request', width: 'min-w-[20rem]' },
  { key: 'emailMessage', label: 'Email Message', width: 'min-w-[20rem]' },
  { key: 'companyProfile', label: 'Company Profile', width: 'min-w-[24rem]' },
]

const SheetTable = ({ rows, loading, error }) => {
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

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-800 shadow-md shadow-rose-100">
        {error}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-glass-border bg-white overflow-hidden transition-all duration-300 shadow-3d mt-6">
      <div className="max-h-[65vh] overflow-auto">
        <table className="min-w-full divide-y divide-glass-border text-left">
          <thead className="bg-white sticky top-0 z-10 text-[9px] font-bold uppercase tracking-[0.2em] text-muted border-b-2 border-glass-border">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 ${col.width}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-glass-border text-sm bg-white">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-muted">
                  Fetching leads from Sheets…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-muted">
                  No leads found yet. Kick off a new job to fill the sheet.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={`${row.email}-${idx}`}
                  className="transition-all duration-200 hover:bg-surface/30 group"
                >
                  <td className="px-4 py-3.5 text-xs font-medium text-muted">{row.date || '—'}</td>
                  <td
                    className="px-4 py-3.5 text-sm font-semibold text-accent tracking-tight cursor-text"
                    onClick={() => handleCellClick(idx, 'name', row.name)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'name' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-sm"
                      />
                    ) : (
                      row.name || '—'
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-muted cursor-text"
                    onClick={() => handleCellClick(idx, 'title', row.title)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'title' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-xs"
                      />
                    ) : (
                      row.title || '—'
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-muted cursor-text"
                    onClick={() => handleCellClick(idx, 'company', row.company)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'company' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-xs"
                      />
                    ) : (
                      row.company || '—'
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="text-accent hover:text-muted hover:underline underline-offset-4 transition-colors font-medium"
                      >
                        {row.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {row.linkedin ? (
                      <a
                        href={row.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline decoration-black decoration-2 underline-offset-2 hover:text-muted transition-colors"
                      >
                        Profile
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {row.website ? (
                      <a
                        href={formatWebsiteUrl(row.website)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline decoration-black decoration-2 underline-offset-2 hover:text-muted transition-colors"
                      >
                        Visit
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-muted cursor-text"
                    onClick={() => handleCellClick(idx, 'connectionRequest', row.connectionRequest)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'connectionRequest' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-xs resize-none"
                      />
                    ) : (
                      <div className="max-w-xs line-clamp-3">{row.connectionRequest || '—'}</div>
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-muted cursor-text"
                    onClick={() => handleCellClick(idx, 'emailMessage', row.emailMessage)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'emailMessage' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-xs resize-none"
                      />
                    ) : (
                      <div className="max-w-xs line-clamp-3">{row.emailMessage || '—'}</div>
                    )}
                  </td>
                  <td
                    className="px-4 py-3.5 text-xs text-muted cursor-text"
                    onClick={() => handleCellClick(idx, 'companyProfile', row.companyProfile)}
                  >
                    {editingCell?.rowIdx === idx && editingCell?.colKey === 'companyProfile' ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        autoFocus
                        rows={3}
                        className="w-full bg-white border border-accent rounded px-2 py-1 text-xs resize-none"
                      />
                    ) : (
                      <div className="max-w-md line-clamp-4">{row.companyProfile || '—'}</div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

SheetTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
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
}

SheetTable.defaultProps = {
  rows: [],
  loading: false,
  error: '',
}

export default SheetTable
