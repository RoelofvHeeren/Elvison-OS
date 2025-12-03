import PropTypes from 'prop-types'
import { CheckCircle2, Circle, Clock4, Loader2 } from 'lucide-react'

const statusClasses = {
  done: 'text-primary',
  in_progress: 'text-blue-600',
  pending: 'text-muted',
}

const iconForStatus = (status) => {
  if (status === 'done') return CheckCircle2
  if (status === 'in_progress') return Loader2
  return Circle
}

const Timeline = ({ steps }) => (
  <div className="glass-panel space-y-6 px-6 py-6">
    {steps.map((step, idx) => {
      const Icon = iconForStatus(step.status)
      const isLast = idx === steps.length - 1

      return (
        <div key={step.key} className="relative flex gap-4">
          <div className="flex flex-col items-center">
            <div
              className={`grid h-10 w-10 place-items-center rounded-full bg-mint/70 ${statusClasses[step.status]} ${
                step.status === 'in_progress' ? 'animate-pulse' : ''
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            {!isLast && <div className="h-full w-px flex-1 bg-outline/80" />}
          </div>
          <div className="pb-8 pt-1">
            <p className="text-sm font-semibold text-ink">{step.label}</p>
            <p className="text-xs text-muted">
              {step.status === 'done'
                ? 'Completed'
                : step.status === 'in_progress'
                  ? 'In progress'
                  : 'Pending'}
            </p>
          </div>
        </div>
      )
    })}
    <div className="flex items-center gap-2 rounded-xl bg-panel px-4 py-3 text-muted">
      <Clock4 className="h-4 w-4" />
      <span className="text-sm">Updates refresh automatically every few seconds.</span>
    </div>
  </div>
)

Timeline.propTypes = {
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      status: PropTypes.oneOf(['done', 'in_progress', 'pending']).isRequired,
    }),
  ).isRequired,
}

export default Timeline
