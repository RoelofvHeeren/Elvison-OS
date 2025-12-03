import client from '../api/client'

export const fetchLeads = async () => {
  const { data } = await client.get('/api/leads')
  return data
}

export const startJob = async (prompt) => {
  const { data } = await client.post('/api/start-job', { prompt })
  return data
}

export const fetchJobStatus = async (jobId) => {
  const { data } = await client.get(`/api/job-status/${jobId}`)
  return data
}

export const writeLeads = async (rows) => {
  const { data } = await client.post('/api/write-leads', { rows })
  return data
}

export const fetchHealth = async () => {
  const { data } = await client.get('/api/health')
  return data
}

export const saveConnection = async (payload) => {
  const { data } = await client.post('/api/connections', payload)
  return data
}

export const fetchConnection = async () => {
  const { data } = await client.get('/api/connections')
  return data
}

export const fetchAuthStatus = async () => {
  const { data } = await client.get('/api/auth/status')
  return data
}

export const fetchSheets = async () => {
  const { data } = await client.get('/api/sheets')
  return data
}

export const fetchSheetRows = async () => {
  const { data } = await client.get('/api/sheet/rows')
  return data
}

export const appendSheetRows = async (rows) => {
  const { data } = await client.post('/api/sheet/append', { rows })
  return data
}

export const disconnectGoogle = async () => {
  const { data } = await client.post('/api/auth/disconnect')
  return data
}

export const testConnection = async (payload) => {
  const { data } = await client.post('/api/connections/test', payload)
  return data
}
