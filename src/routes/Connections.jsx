import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Play, Activity } from 'lucide-react'
import { startWorkflow, fetchHealth } from '../utils/api'

const Connections = () => {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)
  const [jobPrompt, setJobPrompt] = useState('')
  const [jobStatus, setJobStatus] = useState({ loading: false, error: '', success: '' })

  useEffect(() => {
    checkSystem()
  }, [])

  const checkSystem = async () => {
    try {
      const data = await fetchHealth()
      setHealth(data)
    } catch (e) {
      console.error("Health check failed", e)
    }
  }

  const handleStartWorkflow = async () => {
    if (!jobPrompt.trim()) return

    setJobStatus({ loading: true, error: '', success: '' })
    try {
      // Start with empty agent configs for now, using defaults
      const result = await startWorkflow(jobPrompt, {})
      if (result.success) {
        setJobStatus({ loading: false, error: '', success: `Workflow started! Run ID: ${result.run_id}` })
        setJobPrompt('')
      } else {
        setJobStatus({ loading: false, error: 'Failed to start workflow', success: '' })
      }
    } catch (err) {
      setJobStatus({ loading: false, error: err.message || 'Error starting workflow', success: '' })
    }
  }

  return (
    <div className="space-y-8 p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in">
      <div>
        <h1 className="text-3xl font-serif font-bold text-white mb-2">System Status</h1>
        <p className="text-gray-400">Monitor backend health and trigger manual workflows.</p>
      </div>

      {/* Health Status Card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center gap-4 mb-4">
          <div className={`p-3 rounded-full ${health ? 'bg-teal-500/20 text-teal-400' : 'bg-rose-500/20 text-rose-400'}`}>
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">Backend Health</h3>
            <p className="text-sm text-gray-400">
              {health ? 'System connects to Database & API' : 'System is offline or unreachable'}
            </p>
          </div>
        </div>
        {health && (
          <div className="flex items-center gap-2 text-sm text-teal-400 bg-teal-950/30 px-3 py-1.5 rounded-lg w-fit">
            <CheckCircle2 className="w-4 h-4" />
            <span>Online • {new Date(health.timestamp).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {/* Workflow Trigger Card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 rounded-full bg-indigo-500/20 text-indigo-400">
            <Play className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">Manual Trigger</h3>
            <p className="text-sm text-gray-400">Start the Lead Gen workflow manually.</p>
          </div>
        </div>

        <textarea
          value={jobPrompt}
          onChange={e => setJobPrompt(e.target.value)}
          className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-4 min-h-[100px]"
          placeholder="e.g., Find 10 real estate investors in Toronto..."
        />

        <div className="flex items-center justify-between">
          <div className="text-sm">
            {jobStatus.error && <span className="text-rose-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {jobStatus.error}</span>}
            {jobStatus.success && <span className="text-teal-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {jobStatus.success}</span>}
          </div>

          <button
            onClick={handleStartWorkflow}
            disabled={jobStatus.loading || !jobPrompt.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-xl font-medium transition-colors flex items-center gap-2"
          >
            {jobStatus.loading ? 'Starting...' : 'Run Workflow'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Connections
