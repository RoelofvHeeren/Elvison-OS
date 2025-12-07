import ChatKitWidget from '../components/ChatKitWidget'

const NewJob = () => {
  return (
    <div className="flex flex-col gap-6">
      <div className="glass-panel px-5 py-5">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">Agent Chat</p>
        <h1 className="text-3xl font-semibold text-primary">Chat with the Agent Flow</h1>
        <p className="text-sm text-muted">Use the embedded widget to trigger the workflow.</p>
      </div>

      <div className="glass-panel space-y-2 px-5 py-5">
        <ChatKitWidget />
      </div>
    </div>
  )
}

export default NewJob
