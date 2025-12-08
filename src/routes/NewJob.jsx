import ChatKitWidget from '../components/ChatKitWidget'

const NewJob = () => {
  return (
    <div className="flex flex-col gap-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] font-bold text-primary">New Search</p>
        <h1 className="font-serif text-3xl font-bold tracking-tight text-accent">Start a new lead job</h1>
        <p className="text-sm text-muted">Use the embedded widget to trigger the workflow.</p>
      </div>

      <div className="glass-panel space-y-2 px-5 py-5">
        <ChatKitWidget />
      </div>
    </div>
  )
}

export default NewJob
