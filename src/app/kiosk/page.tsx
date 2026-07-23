'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/offline/db'
import { startBackgroundSync } from '@/lib/offline/sync'
import { KioskWorker, KioskLogEntry, KioskAttendancePair } from '@/types/kiosk'
import KioskHeader from '@/components/kiosk/KioskHeader'
import KioskScanner from '@/components/kiosk/KioskScanner'
import ManualAttendanceModal from '@/components/kiosk/ManualAttendanceModal'
import RegisterWorkerModal from '@/components/kiosk/RegisterWorkerModal'
import TodayAttendanceTable from '@/components/kiosk/TodayAttendanceTable'
import KioskOvertimeModal from '@/components/kiosk/KioskOvertimeModal'

type HistoryPeriod = 'day' | 'week' | 'month'
type HistoryAttendancePair = KioskAttendancePair & { local_date: string }

interface RawAttendanceLog {
  id: string
  worker_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  source: string | null
  workers: { name: string; nik: string; position: 'TK' | 'KN' | null } | null
}

export default function KioskPage() {
  const router = useRouter()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('Memuat Proyek...')
  const [workers, setWorkers] = useState<KioskWorker[]>([])
  const [logs, setLogs] = useState<KioskLogEntry[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [queuedCount, setQueuedCount] = useState(0)
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('day')
  const [historyLoading, setHistoryLoading] = useState(false)

  const [scanMode, setScanMode] = useState<'in' | 'out' | null>(null)
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number }>({ latitude: -6.2, longitude: 106.8 })

  const [showManual, setShowManual] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showOvertime, setShowOvertime] = useState(false)

  const updateQueueStats = useCallback(async () => {
    try {
      const count = await db.queue.count()
      setQueuedCount(count)
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : 'Queue stats error')
    }
  }, [])

  const fetchProjectDetails = useCallback(async () => {
    if (!projectId) return
    const { data } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
    if (data) setProjectName(data.name)
  }, [projectId])

  const fetchWorkersAndLogs = useCallback(async () => {
    if (!projectId) return
    setHistoryLoading(true)
    try {
      const { data: wData, error: wError } = await supabase
        .from('workers')
        .select('id, name, nik, position, job_scope, face_descriptor')
        .eq('project_id', projectId)
        .eq('is_active', true)

      if (wError) throw wError
      const rawWorkers = (wData || []) as { id: string; name: string; nik: string; position: 'TK' | 'KN' | null; job_scope: string; face_descriptor: unknown }[]
      setWorkers(rawWorkers.map(w => ({
        id: w.id,
        name: w.name,
        nik: w.nik,
        position: w.position,
        job_scope: w.job_scope,
        face_descriptor: Array.isArray(w.face_descriptor) ? (w.face_descriptor as number[]) : []
      })))

      const now = new Date()
      const rangeStart = new Date(now)
      rangeStart.setHours(0, 0, 0, 0)
      if (historyPeriod === 'week') {
        rangeStart.setDate(rangeStart.getDate() - 6)
      } else if (historyPeriod === 'month') {
        rangeStart.setDate(1)
      }

      const { data: attData, error: attError } = await supabase
        .from('attendance')
        .select('id, worker_id, type, occurred_at, source, workers(name, nik, position)')
        .eq('project_id', projectId)
        .gte('occurred_at', rangeStart.toISOString())
        .lte('occurred_at', now.toISOString())
        .order('occurred_at', { ascending: false })

      if (attError) throw attError
      const rawLogs = (attData as unknown as RawAttendanceLog[]) || []
      const remoteLogs: KioskLogEntry[] = rawLogs.map(att => ({
        id: att.id,
        worker_id: att.worker_id || '',
        name: att.workers?.name || 'Tidak Dikenal',
        nik: att.workers?.nik || '-',
        position: att.workers?.position || null,
        type: (att.type as 'in' | 'out') || 'in',
        occurred_at: att.occurred_at,
        source: (att.source as 'face' | 'manual') || 'face',
        synced: true
      }))

      const workerById = new Map(rawWorkers.map(worker => [worker.id, worker]))
      const queuedLogs: KioskLogEntry[] = (await db.queue.toArray())
        .filter(item => {
          const occurredAt = new Date(item.payload.occurred_at)
          return item.payload.project_id === projectId
            && occurredAt >= rangeStart
            && occurredAt <= now
            && item.status !== 'sent'
        })
        .map(item => {
          const worker = workerById.get(item.worker_id)
          return {
            id: `queued-${item.client_event_id}`,
            worker_id: item.worker_id,
            name: worker?.name || item.worker_name,
            nik: worker?.nik || '-',
            position: worker?.position || null,
            type: item.type,
            occurred_at: item.payload.occurred_at,
            source: item.payload.source === 'manual' ? 'manual' : 'face',
            synced: false
          }
        })

      setLogs([...remoteLogs, ...queuedLogs])
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : 'Fetch error')
    } finally {
      setHistoryLoading(false)
    }
  }, [historyPeriod, projectId])

  const getGpsLocation = useCallback((): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve, reject) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => reject(new Error('Lokasi GPS wajib diaktifkan untuk melakukan absensi.')),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        )
      } else {
        reject(new Error('Perangkat ini tidak mendukung lokasi GPS.'))
      }
    })
  }, [])

  const cooldownCheck = useCallback((workerId: string, type: 'in' | 'out'): string | null => {
    const oneHourAgo = new Date(Date.now() - 3600000)
    const recentLog = logs.find(l => l.worker_id === workerId && l.type === type && new Date(l.occurred_at) > oneHourAgo)
    if (recentLog) {
      const timeFormatted = new Date(recentLog.occurred_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      return `${recentLog.name} sudah Absen ${type === 'in' ? 'Masuk' : 'Pulang'} pada jam ${timeFormatted}`
    }
    return null
  }, [logs])

  const submitOrQueue = useCallback(async (
    payload: {
      client_event_id: string
      worker_id: string
      project_id: string
      type: 'in' | 'out'
      occurred_at: string
      gps: { latitude: number; longitude: number }
      source: string
    },
    blob: Blob,
    workerName: string
  ) => {
    if (navigator.onLine) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Sesi kiosk tidak tersedia')

        const evidenceBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '')
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })

        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ events: [{ client_event_id: payload.client_event_id, payload, evidenceBase64 }] })
        })
        const data = await response.json()
        const result = data.results?.[0]
        if (!response.ok || result?.status !== 'success') {
          throw new Error(result?.error || data.error || 'Gagal menyimpan absensi')
        }

        setStatusMsg(`Absensi ${payload.type === 'in' ? 'Masuk' : 'Pulang'} berhasil: ${workerName}`)
        await fetchWorkersAndLogs()
        return
      } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : 'Submit error')
        if (err instanceof Error && /lokasi|proyek|pekerja|aktif/i.test(err.message)) {
          setErrorMsg(err.message)
          return
        }
      }
    }

    // Offline queue
    await db.queue.add({
      client_event_id: payload.client_event_id,
      worker_id: payload.worker_id,
      worker_name: workerName,
      type: payload.type,
      payload,
      evidence: blob,
      created_at: new Date(),
      attempts: 0,
      status: 'queued'
    })
    const worker = workers.find(item => item.id === payload.worker_id)
    setLogs(currentLogs => [
      {
        id: `queued-${payload.client_event_id}`,
        worker_id: payload.worker_id,
        name: worker?.name || workerName,
        nik: worker?.nik || '-',
        position: worker?.position || null,
        type: payload.type,
        occurred_at: payload.occurred_at,
        source: payload.source === 'manual' ? 'manual' : 'face',
        synced: false
      },
      ...currentLogs
    ])
    setStatusMsg(`Absensi ${payload.type === 'in' ? 'Masuk' : 'Pulang'} disimpan offline: ${workerName}`)
    await updateQueueStats()
  }, [fetchWorkersAndLogs, updateQueueStats, workers])

  const startScan = useCallback(async (type: 'in' | 'out') => {
    setErrorMsg(null); setStatusMsg(null)
    try {
      const gps = await getGpsLocation()
      setGpsCoords(gps)
      setScanMode(type)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mendapatkan lokasi GPS')
    }
  }, [getGpsLocation])

  const handleScanComplete = useCallback(async (worker: KioskWorker, evidenceBlob: Blob) => {
    if (!scanMode || !projectId) return
    const clientEventId = crypto.randomUUID()
    await submitOrQueue({
      client_event_id: clientEventId,
      worker_id: worker.id,
      project_id: projectId,
      type: scanMode,
      occurred_at: new Date().toISOString(),
      gps: gpsCoords,
      source: 'face'
    }, evidenceBlob, worker.name)
    setScanMode(null)
  }, [scanMode, projectId, gpsCoords, submitOrQueue])

  const handleManualSubmit = useCallback(async (worker: KioskWorker, evidenceBlob: Blob, note: string) => {
    if (!scanMode || !projectId) return
    const clientEventId = crypto.randomUUID()
    await submitOrQueue({
      client_event_id: clientEventId,
      worker_id: worker.id,
      project_id: projectId,
      type: scanMode,
      occurred_at: new Date().toISOString(),
      gps: gpsCoords,
      source: 'manual'
    }, evidenceBlob, `${worker.name} (${note})`)
    setShowManual(false)
    setScanMode(null)
  }, [scanMode, projectId, gpsCoords, submitOrQueue])

  // Init
  useEffect(() => {
    const pId = localStorage.getItem('kiosk_project_id')
    if (!pId) { router.push('/login'); return }

    const t = setTimeout(async () => {
      setProjectId(pId)
      setIsOnline(navigator.onLine)

      try {
        const stuck = await db.queue.where('status').equals('syncing').toArray()
        if (stuck.length > 0) {
          const stuckIds = stuck.map(item => item.id).filter((id): id is number => id !== undefined)
          await db.queue.where('id').anyOf(stuckIds).modify({ status: 'failed' })
        }
      } catch (err) {
        console.error('Failed to recover stuck items:', err)
      }
    }, 0)

    const heartbeat = setInterval(() => {
      if (navigator.onLine && pId) {
        supabase.from('kiosk_accounts')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('project_id', pId)
          .then()
      }
    }, 30000)

    const handleOnline = () => {
      setIsOnline(true)
      startBackgroundSync().then(() => {
        updateQueueStats()
        fetchWorkersAndLogs()
      })
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearTimeout(t)
      clearInterval(heartbeat)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [router, updateQueueStats, fetchWorkersAndLogs])

  useEffect(() => {
    if (projectId) {
      const t = setTimeout(() => {
        fetchProjectDetails()
        fetchWorkersAndLogs()
        updateQueueStats()
        if (navigator.onLine) {
          startBackgroundSync().then(() => {
            updateQueueStats()
            fetchWorkersAndLogs()
          })
        }
      }, 0)
      return () => clearTimeout(t)
    }
  }, [projectId, fetchProjectDetails, fetchWorkersAndLogs, updateQueueStats])

  // Realtime subscription
  useEffect(() => {
    if (!projectId) return
    const channel = supabase
      .channel('kiosk-logs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'attendance',
        filter: `project_id=eq.${projectId}`
      }, () => { fetchWorkersAndLogs() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId, fetchWorkersAndLogs])

  // Build attendance pairs for table
  const attendancePairs: HistoryAttendancePair[] = (() => {
    const map = new Map<string, HistoryAttendancePair>()
    for (const log of logs) {
      if (!log.worker_id) continue
      const occurredAt = new Date(log.occurred_at)
      const localDate = [
        occurredAt.getFullYear(),
        String(occurredAt.getMonth() + 1).padStart(2, '0'),
        String(occurredAt.getDate()).padStart(2, '0')
      ].join('-')
      const pairKey = `${log.worker_id}:${localDate}`
      if (!map.has(pairKey)) {
        map.set(pairKey, {
          worker_id: log.worker_id,
          local_date: localDate,
          name: log.name,
          nik: log.nik,
          position: log.position,
          clock_in: null,
          clock_out: null,
          status_day: 0,
          method: log.source,
          synced: log.synced
        })
      }
      const pair = map.get(pairKey)!
      const time = occurredAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      if (log.type === 'in' && (!pair.clock_in || time < pair.clock_in)) {
        pair.clock_in = time
        if (pair.method !== log.source) pair.method = 'mixed'
      }
      if (log.type === 'out' && (!pair.clock_out || time > pair.clock_out)) {
        pair.clock_out = time
        if (pair.method !== log.source) pair.method = 'mixed'
      }
      pair.status_day = (pair.clock_in && pair.clock_out) ? 1.0 : (pair.clock_in || pair.clock_out) ? 0.5 : 0
      if (!log.synced) pair.synced = false
    }
    return Array.from(map.values()).sort((a, b) => b.local_date.localeCompare(a.local_date) || a.name.localeCompare(b.name))
  })()

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 text-slate-800">
      <div className="max-w-5xl mx-auto space-y-6">
        <KioskHeader
          projectName={projectName}
          isOnline={isOnline}
          queuedCount={queuedCount}
          onRegisterClick={() => setShowRegister(true)}
          onHistoryClick={() => setShowHistory(!showHistory)}
          onOvertimeClick={() => setShowOvertime(true)}
        />

        {errorMsg && (
          <div className="alert-error animate-fade-up">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} aria-label="Tutup" className="text-red-400 hover:text-red-600 font-bold text-lg leading-none">&times;</button>
          </div>
        )}

        {statusMsg && (
          <div className="alert-success animate-fade-up">
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg(null)} aria-label="Tutup" className="text-emerald-400 hover:text-emerald-600 font-bold text-lg leading-none">&times;</button>
          </div>
        )}

        {/* Scanner or Buttons */}
        <div className="card p-6 md:p-8">
          {scanMode ? (
            <KioskScanner
              workers={workers}
              scanMode={scanMode}
              gpsCoords={gpsCoords}
              onScanComplete={handleScanComplete}
              onCancel={() => setScanMode(null)}
              onManualFallback={() => setShowManual(true)}
              cooldownCheck={cooldownCheck}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <button
                onClick={() => startScan('in')}
                className="group relative overflow-hidden py-14 bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-white rounded-2xl shadow-lg shadow-emerald-800/25 transition duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40"
              >
                <span className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-white/10 blur-2xl transition group-hover:bg-white/15" />
                <span className="relative flex flex-col items-center gap-3">
                  <LogIn className="h-9 w-9 opacity-90" strokeWidth={2.25} />
                  <span className="font-bold text-2xl tracking-wide">ABSEN MASUK</span>
                  <span className="text-xs font-medium text-emerald-100/80">Scan wajah untuk clock-in</span>
                </span>
              </button>
              <button
                onClick={() => startScan('out')}
                className="group relative overflow-hidden py-14 bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 text-white rounded-2xl shadow-lg shadow-red-800/25 transition duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-500/40"
              >
                <span className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-white/10 blur-2xl transition group-hover:bg-white/15" />
                <span className="relative flex flex-col items-center gap-3">
                  <LogOut className="h-9 w-9 opacity-90" strokeWidth={2.25} />
                  <span className="font-bold text-2xl tracking-wide">ABSEN PULANG</span>
                  <span className="text-xs font-medium text-red-100/80">Scan wajah untuk clock-out</span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Today Attendance Table */}
        {(showHistory || attendancePairs.length > 0) && (
          <TodayAttendanceTable
            pairs={attendancePairs}
            loading={historyLoading}
            period={historyPeriod}
            onPeriodChange={setHistoryPeriod}
          />
        )}
      </div>

      {/* Modals */}
      <ManualAttendanceModal
        isOpen={showManual}
        onClose={() => { setShowManual(false); if (scanMode) setScanMode(null) }}
        workers={workers}
        scanMode={scanMode || 'in'}
        gpsCoords={gpsCoords}
        onSubmit={handleManualSubmit}
        cooldownCheck={cooldownCheck}
      />

      {projectId && (
        <>
          <RegisterWorkerModal isOpen={showRegister} onClose={() => setShowRegister(false)} projectId={projectId} />
          <KioskOvertimeModal isOpen={showOvertime} onClose={() => setShowOvertime(false)} onSubmitted={setStatusMsg} projectId={projectId} projectName={projectName} workers={workers} />
        </>
      )}
    </div>
  )
}
