import Dexie, { Table } from 'dexie'

export interface QueuedEvent {
  id?: number
  client_event_id: string
  worker_id: string
  worker_name: string
  type: 'in' | 'out'
  payload: {
    client_event_id: string
    worker_id: string
    project_id: string
    type: 'in' | 'out'
    occurred_at: string
    gps: { latitude: number; longitude: number }
    source: string
  }
  evidence: Blob
  created_at: Date
  attempts: number
  status: 'queued' | 'syncing' | 'failed' | 'sent'
}

class KioskOfflineDatabase extends Dexie {
  queue!: Table<QueuedEvent>

  constructor() {
    super('KioskOfflineDB')
    this.version(2).stores({
      queue: '++id, client_event_id, worker_id, status, created_at'
    })
  }
}

export const db = new KioskOfflineDatabase()
