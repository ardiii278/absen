import { supabase } from '@/lib/supabase'

// Job scopes are stored as a JSON config file in the kiosk-photos bucket
// Shape: { [projectId: string]: string[] }
const CONFIG_PATH = 'config/job_scopes.json'
const BUCKET = 'kiosk-photos'

export type JobScopeMap = Record<string, string[]>

export async function fetchJobScopeConfig(): Promise<JobScopeMap> {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (token) {
      const response = await fetch('/api/job-scopes', { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) {
        const result = await response.json() as { scopes?: JobScopeMap }
        return result.scopes || {}
      }
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(CONFIG_PATH)
    if (error || !data) return {}
    return JSON.parse(await data.text()) as JobScopeMap
  } catch {
    return {}
  }
}

export async function saveJobScopeConfig(map: JobScopeMap): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sesi admin tidak valid')
  const entries = Object.entries(map)
  for (const [projectId, scopes] of entries) {
    const response = await fetch('/api/job-scopes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, scopes })
    })
    if (!response.ok) {
      const result = await response.json() as { error?: string }
      throw new Error(result.error || 'Gagal menyimpan job scope')
    }
  }
}

export async function saveProjectJobScopes(projectId: string, scopes: string[]): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sesi admin tidak valid')
  const response = await fetch('/api/job-scopes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ projectId, scopes })
  })
  if (!response.ok) {
    const result = await response.json() as { error?: string }
    throw new Error(result.error || 'Gagal menyimpan job scope')
  }
}

// Merge configured scopes with distinct scopes already used by workers in a project
export async function fetchProjectJobScopes(projectId: string): Promise<string[]> {
  const [config, workerScopes] = await Promise.all([
    fetchJobScopeConfig(),
    supabase.from('workers').select('job_scope').eq('project_id', projectId)
      .then((res: { data: { job_scope: string | null }[] | null }) =>
        (res.data || []).map(w => w.job_scope).filter((s): s is string => !!s)
      )
  ])
  const configured = config[projectId] || []
  return Array.from(new Set([...configured, ...workerScopes])).sort()
}
