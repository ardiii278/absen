import { db } from './db'

export async function startBackgroundSync() {
  if (!navigator.onLine) return

  const queuedItems = await db.queue.where('status').anyOf('queued', 'failed').toArray()
  if (queuedItems.length === 0) return

  // Mark status as syncing
  const ids = queuedItems.map(item => item.id!)
  await db.queue.where('id').anyOf(ids).modify({ status: 'syncing' })

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

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: payloadEvents })
    })

    if (!res.ok) throw new Error('Sync endpoint failed')

    const data = await res.json()
    const results = data.results || []

    for (const result of results) {
      const dbItem = queuedItems.find(item => item.client_event_id === result.client_event_id)
      if (dbItem) {
        if (result.status === 'success') {
          // Delete from IndexedDB queue on successful server ingestion
          await db.queue.delete(dbItem.id!)
        } else {
          // Update failed attempts and retry status
          await db.queue.update(dbItem.id!, {
            status: 'failed',
            attempts: dbItem.attempts + 1
          })
        }
      }
    }
  } catch (err: unknown) {
    console.error('Offline sync failed:', err)
    // Reset status back to failed/queued to allow future retry
    await db.queue.where('id').anyOf(ids).modify(item => {
      item.status = 'failed'
      item.attempts += 1
    })
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
