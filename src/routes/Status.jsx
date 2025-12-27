import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Timeline from '../components/Timeline'
import { fetchJobStatus } from '../utils/api'

const DEFAULT_STEPS = {
  searching_companies: 'pending',
  finding_contacts: 'pending',
  enriching: 'pending',
  writing_to_sheet: 'pending',
}

const LABELS = {
  searching_companies: 'Searching companies',
  finding_contacts: 'Finding decision makers',
  enriching: 'Enriching emails',
  writing_to_sheet: 'Writing to sheet',
}

const Status = () => {
  const { jobId } = useParams()
  const [stepStatus, setStepStatus] = useState(DEFAULT_STEPS)
  const [error, setError] = useState('')

  const fetchStatus = async () => {
    if (!jobId) return
    try {
      const data = await fetchJobStatus(jobId)
      if (Array.isArray(data?.steps)) {
        const incoming = data.steps.reduce((acc, step) => {
          const key = step.label?.replaceAll(' ', '_').toLowerCase() || step.name
          const normalized =
            step.status === 'running' ? 'in_progress' : step.status === 'pending' ? 'pending' : 'done'
          acc[key] = normalized
          return acc
        }, {})
        setStepStatus((prev) => ({ ...prev, ...incoming }))
      } else if (data?.steps) {
        const normalized = Object.fromEntries(
          Object.entries(data.steps).map(([k, v]) => [
            k,
            v === 'running' ? 'in_progress' : v === 'pending' ? 'pending' : v,
          ]),
        )
        setStepStatus((prev) => ({ ...prev, ...normalized }))
      }
    } catch (err) {
      console.error(err)
      setError('Unable to fetch job status from the Agent Flow API.')
    }
  }

  useEffect(() => {
    if (!jobId) return
    fetchStatus()
    const interval = setInterval(fetchStatus, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const steps = useMemo(
    () =>
      Object.keys(LABELS).map((key) => ({
        key,
        label: LABELS[key],
        status: stepStatus[key] || 'pending',
      })),
    [stepStatus],
  )

  const isComplete = steps.every((step) => step.status === 'done')

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
      <div className="glass-panel px-5 py-5">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary">Job status</p>
        <h1 className="text-3xl font-bold text-accent">Tracking job {jobId || '—'}</h1>
        <p className="text-sm text-muted">
          Polling Agent Flow every 4 seconds to reflect the latest step.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {!jobId && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" />
          Provide a jobId to see progress. Start a job from the CRM or New Job page.
        </div>
      )}

      <Timeline steps={steps} />

      {isComplete && (
        <div className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-mint/80 px-5 py-4 text-primary shadow-soft">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">Job completed</p>
              <p className="text-xs text-primaryDark">
                Data should now be visible in your AI Lead Sheet and CRM view.
              </p>
            </div>
          </div>
          <Link
            to="/crm"
            className="btn-primary"
          >
            View in CRM
          </Link>
        </div>
      )}
    </div>
  )
}

export default Status
