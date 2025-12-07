import PropTypes from 'prop-types'

const columns = [
  { key: 'date', label: 'Date Added' },
  { key: 'name', label: 'Name' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'website', label: 'Company Website' },
]

const SheetTable = ({ rows, loading, error }) => {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-800 shadow-md shadow-rose-100">
        {error}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-glass-border bg-black/50 backdrop-blur-md overflow-hidden transition-all duration-300 shadow-hud mt-6">
      <div className="max-h-[65vh] overflow-auto">
        <table className="min-w-full divide-y divide-glass-border text-left">
          <thead className="bg-primary/5 text-[10px] font-mono font-bold uppercase tracking-widest text-primary-dim">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-glass-border text-sm">
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
                  className="transition-all duration-200 hover:bg-primary/5 group"
                >
                  <td className="px-4 py-3 text-sm font-mono text-primary-glow/90">{row.date || '—'}</td>
                  <td className="px-4 py-3 text-white font-medium tracking-wide">{row.name || '—'}</td>
                  <td className="px-4 py-3 text-muted">{row.title || '—'}</td>
                  <td className="px-4 py-3 text-muted">{row.company || '—'}</td>
                  <td className="px-4 py-3 text-muted">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="text-primary hover:text-primary-glow hover:underline underline-offset-4 transition-colors font-mono text-xs"
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
                        className="text-primary underline decoration-mint decoration-2 underline-offset-2"
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
                        href={row.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline decoration-mint decoration-2 underline-offset-2"
                      >
                        Visit
                      </a>
                    ) : (
                      '—'
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
      firstName: PropTypes.string,
      lastName: PropTypes.string,
      company: PropTypes.string,
      title: PropTypes.string,
      email: PropTypes.string,
      linkedin: PropTypes.string,
      website: PropTypes.string,
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
