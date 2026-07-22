import { describe, it, expect } from 'vitest'

interface MockQueuedEvent {
  id: string
  client_event_id: string
  payload: unknown
  status: 'queued' | 'syncing' | 'failed'
  attempts: number
}

class MockQueueManager {
  private queue: MockQueuedEvent[] = []

  add(item: Omit<MockQueuedEvent, 'status' | 'attempts'>) {
    this.queue.push({
      ...item,
      status: 'queued',
      attempts: 0
    })
  }

  getQueue() {
    return this.queue
  }

  startSync(): MockQueuedEvent[] {
    const items = this.queue.filter(i => i.status === 'queued' || i.status === 'failed')
    items.forEach(i => {
      i.status = 'syncing'
    })
    return items
  }

  resolveSync(clientEventId: string, success: boolean) {
    const idx = this.queue.findIndex(i => i.client_event_id === clientEventId)
    if (idx !== -1) {
      if (success) {
        // Remove from queue on success
        this.queue.splice(idx, 1)
      } else {
        // Mark failed and increment attempts
        this.queue[idx].status = 'failed'
        this.queue[idx].attempts += 1
      }
    }
  }

  recoverSyncingAfterCrash() {
    // If browser crashed mid-sync, some events might be left in 'syncing' state.
    // Reset them to 'failed' (or 'queued') so they can be retried.
    this.queue.forEach(i => {
      if (i.status === 'syncing') {
        i.status = 'failed'
      }
    })
  }
}

describe('Offline Queue Recovery & Lifecycle', () => {
  it('should transition status correctly during sync lifecycle', () => {
    const manager = new MockQueueManager()
    manager.add({ id: '1', client_event_id: 'event-a', payload: {} })
    manager.add({ id: '2', client_event_id: 'event-b', payload: {} })

    const queue = manager.getQueue()
    expect(queue.length).toBe(2)
    expect(queue[0].status).toBe('queued')

    // Start sync
    const syncing = manager.startSync()
    expect(syncing.length).toBe(2)
    expect(queue[0].status).toBe('syncing')

    // Resolve success for event-a, fail for event-b
    manager.resolveSync('event-a', true)
    manager.resolveSync('event-b', false)

    expect(queue.length).toBe(1)
    expect(queue[0].client_event_id).toBe('event-b')
    expect(queue[0].status).toBe('failed')
    expect(queue[0].attempts).toBe(1)
  })

  it('should recover stuck syncing items after crash', () => {
    const manager = new MockQueueManager()
    manager.add({ id: '1', client_event_id: 'event-c', payload: {} })
    
    // Start sync (marks syncing)
    manager.startSync()
    expect(manager.getQueue()[0].status).toBe('syncing')

    // Recover from crash
    manager.recoverSyncingAfterCrash()
    expect(manager.getQueue()[0].status).toBe('failed')
  })
})
