import { db } from './db'
import { supabase } from '@/lib/supabase'

export async function startBackgroundSync(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 }

  const queuedItems = await db.queue.where('status').anyOf('queued', 'failed').toArray()
  if (queuedItems.length === 0) return { synced: 0, failed: 0 }

  const ids = queuedItems.map(item => item.id!).filter(id => id !== undefined)
  await db.queue.where('id').anyOf(ids).modify({ status: 'syncing' })

  let synced = 0
  let failed = 0

  try {
    const payloadEvents = []
    for (const item of queuedItems) {
      const base64 = await blobToBase64(item.evidence)
      payloadEvents.push({
        client_event_id: item.client_event_id,
        payload: item.payload,
        evidenceBase64: base64
      })
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sesi tidak tersedia')

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ events: payloadEvents })
    })

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null)
      throw new Error(errorBody?.error || `Sync endpoint gagal (${res.status})`)
    }

    const data = await res.json()
    const results = data.results || []

    for (const result of results) {
      const dbItem = queuedItems.find(item => item.client_event_id === result.client_event_id)
      if (dbItem && dbItem.id) {
        if (result.status === 'success') {
          await db.queue.delete(dbItem.id)
          synced++
        } else {
          console.error(`Sync absensi gagal: ${result.error || 'Error tidak diketahui'}`)
          await db.queue.update(dbItem.id, {
            status: 'failed',
            attempts: dbItem.attempts + 1
          })
          failed++
        }
      }
    }
  } catch (err: unknown) {
    console.error('Offline sync failed:', err)
    await db.queue.where('id').anyOf(ids).modify(item => {
      item.status = 'failed'
      item.attempts += 1
    })
    failed = queuedItems.length
  }

  return { synced, failed }
}

export async function getQueuedWorkerIds(): Promise<Set<string>> {
  try {
    const items = await db.queue.where('status').anyOf('queued', 'failed', 'syncing').toArray()
    return new Set(items.map(i => i.worker_id))
  } catch {
    return new Set()
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1]
      resolve(base64String)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
