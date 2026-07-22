'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { watermark } from '@/lib/watermark'
import { createFaceMatcher } from '@/lib/face/matcher'
import { db } from '@/lib/offline/db'

interface Worker {
  id: string
  name: string
  nik: string
  face_descriptor: number[]
}

interface LogEntry {
  id: string
  name: string
  type: 'in' | 'out'
  occurred_at: string
  source: string
}

interface RawAttendanceLog {
  id: string
  type: 'in' | 'out' | null
  occurred_at: string
  source: string | null
  workers: { name: string } | null
}

export default function KioskPage() {
  const router = useRouter()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('Memuat Proyek...')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [queuedCount, setQueuedCount] = useState(0)

  // Camera & Scanning States
  const [scanMode, setScanMode] = useState<'in' | 'out' | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [timeRemaining, setTimeRemaining] = useState(10)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number }>({ latitude: -6.2, longitude: 106.8 })

  // Manual fallback selection
  const [showManualSelection, setShowManualSelection] = useState(false)
  const [selectedWorkerId, setSelectedWorkerId] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // 1. Memoized Helpers
  const updateQueueStats = useCallback(async () => {
    try {
      const count = await db.queue.count()
      setQueuedCount(count)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui statistik antrean'
      console.error(msg)
    }
  }, [])

  const fetchProjectDetails = useCallback(async () => {
    if (!projectId) return
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .maybeSingle()

      if (error) throw error
      if (data) setProjectName(data.name)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil detail proyek'
      console.error(msg)
    }
  }, [projectId])

  const fetchWorkersAndLogs = useCallback(async () => {
    if (!projectId) return
    try {
      // Fetch active workers
      const { data: wData, error: wError } = await supabase
        .from('workers')
        .select('id, name, nik, face_descriptor')
        .eq('project_id', projectId)
        .eq('is_active', true)

      if (wError) throw wError

      const rawWorkers = (wData || []) as { id: string; name: string; nik: string; face_descriptor: unknown }[]
      const mappedWorkers: Worker[] = rawWorkers.map((w) => ({
        id: w.id,
        name: w.name,
        nik: w.nik,
        face_descriptor: Array.isArray(w.face_descriptor) ? (w.face_descriptor as number[]) : []
      }))
      setWorkers(mappedWorkers)

      // Fetch logs for today
      const today = new Date().toISOString().split('T')[0]
      const { data: attData, error: attError } = await supabase
        .from('attendance')
        .select('id, type, occurred_at, source, workers(name)')
        .eq('project_id', projectId)
        .gte('occurred_at', `${today}T00:00:00Z`)
        .order('occurred_at', { ascending: false })

      if (attError) throw attError

      const rawLogs = (attData as unknown as RawAttendanceLog[]) || []
      const mappedLogs: LogEntry[] = rawLogs.map((att) => ({
        id: att.id,
        name: att.workers?.name || 'Pekerja Tidak Dikenal',
        type: (att.type as 'in' | 'out') || 'in',
        occurred_at: att.occurred_at,
        source: att.source || 'face'
      }))

      setLogs(mappedLogs)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil data absensi'
      console.error(msg)
    }
  }, [projectId])

  const stopScan = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
    setScanMode(null)
    setDeadline(null)
  }, [])

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
    blob: Blob
  ) => {
    const evidencePath = `evidence/${payload.client_event_id}.jpg`

    if (navigator.onLine) {
      try {
        // Upload photo
        const { error: uploadErr } = await supabase.storage
          .from('kiosk-photos')
          .upload(evidencePath, blob, { contentType: 'image/jpeg' })

        if (uploadErr) throw uploadErr

        // Insert database
        const { error: insertErr } = await supabase.from('attendance').insert({
          client_event_id: payload.client_event_id,
          worker_id: payload.worker_id,
          project_id: payload.project_id,
          type: payload.type,
          occurred_at: payload.occurred_at,
          evidence_path: evidencePath,
          gps: payload.gps,
          source: payload.source
        })

        if (insertErr) {
          // Rollback storage photo on database insert fail
          await supabase.storage.from('kiosk-photos').remove([evidencePath])
          throw insertErr
        }
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Gagal menyimpan absensi'
        console.error(msg)
      }
    }

    // Offline Store using Dexie
    await db.queue.add({
      client_event_id: payload.client_event_id,
      payload,
      evidence: blob,
      created_at: new Date(),
      attempts: 0,
      status: 'queued'
    })
    await updateQueueStats()
  }, [updateQueueStats])

  const triggerFaceMatch = useCallback(async () => {
    if (!videoRef.current || !scanMode || !projectId) return
    setErrorMsg(null)

    // Cooldown check helper (1 hour per worker/type)
    const hasCooldown = (workerId: string, type: 'in' | 'out') => {
      const oneHourAgo = new Date(Date.now() - 3600000)
      const recentLog = logs.find(
        (l) => l.type === type && new Date(l.occurred_at) > oneHourAgo
      )
      return !!recentLog
    }

    try {
      // Simulate descriptor scan
      const mockScanDescriptor = Array.from({ length: 128 }, () => Math.random())
      const matcher = createFaceMatcher(workers)
      const match = matcher.findBestMatch(mockScanDescriptor)

      if (match.label === 'unknown') {
        setErrorMsg('Wajah tidak dikenali. Coba lagi atau gunakan Fallback Manual.')
        return
      }

      const matchedWorker = workers.find((w) => w.id === match.label)
      if (!matchedWorker) return

      // Cooldown Check
      if (hasCooldown(matchedWorker.id, scanMode)) {
        setErrorMsg(`Sudah melakukan absensi ${scanMode === 'in' ? 'Masuk' : 'Pulang'} dalam 1 jam terakhir.`)
        stopScan()
        return
      }

      // Create evidence photo with watermark
      const evidenceBlob = await watermark(videoRef.current, { time: new Date(), gps: gpsCoords })
      if (!evidenceBlob) {
        throw new Error('Gagal memproses foto bukti')
      }

      // Create attendance event payload
      const clientEventId = crypto.randomUUID()
      const payload = {
        client_event_id: clientEventId,
        worker_id: matchedWorker.id,
        project_id: projectId,
        type: scanMode,
        occurred_at: new Date().toISOString(),
        gps: gpsCoords,
        source: 'face'
      }

      await submitOrQueue(payload, evidenceBlob)
      setStatusMsg(`Absensi ${scanMode === 'in' ? 'Masuk' : 'Pulang'} sukses untuk ${matchedWorker.name}`)
      stopScan()
      await fetchWorkersAndLogs()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Pencocokan gagal'
      setErrorMsg(msg)
    }
  }, [scanMode, projectId, logs, workers, gpsCoords, stopScan, submitOrQueue, fetchWorkersAndLogs])

  const handleManualFallback = useCallback(async () => {
    if (!selectedWorkerId || !scanMode || !videoRef.current || !projectId) return
    setErrorMsg(null)

    try {
      const selectedWorker = workers.find((w) => w.id === selectedWorkerId)
      if (!selectedWorker) return

      const evidenceBlob = await watermark(videoRef.current, { time: new Date(), gps: gpsCoords })
      if (!evidenceBlob) {
        throw new Error('Gagal memproses foto bukti')
      }

      const clientEventId = crypto.randomUUID()
      const payload = {
        client_event_id: clientEventId,
        worker_id: selectedWorker.id,
        project_id: projectId,
        type: scanMode,
        occurred_at: new Date().toISOString(),
        gps: gpsCoords,
        source: 'manual'
      }

      await submitOrQueue(payload, evidenceBlob)
      setStatusMsg(`Absensi Manual ${scanMode === 'in' ? 'Masuk' : 'Pulang'} sukses untuk ${selectedWorker.name}`)
      stopScan()
      setShowManualSelection(false)
      setSelectedWorkerId('')
      await fetchWorkersAndLogs()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses fallback manual'
      setErrorMsg(msg)
    }
  }, [selectedWorkerId, scanMode, projectId, workers, gpsCoords, submitOrQueue, stopScan, fetchWorkersAndLogs])

  const getGpsLocation = useCallback((): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => resolve(gpsCoords)
        )
      } else {
        resolve(gpsCoords)
      }
    })
  }, [gpsCoords])

  const startScan = useCallback(async (type: 'in' | 'out') => {
    setErrorMsg(null)
    setStatusMsg(null)
    setScanMode(type)
    setTimeRemaining(10)
    setDeadline(Date.now() + 10000)
    setIsCameraActive(true)

    try {
      const gps = await getGpsLocation()
      setGpsCoords(gps)

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch {
      setErrorMsg('Gagal mengakses kamera.')
      setIsCameraActive(false)
      setScanMode(null)
    }
  }, [getGpsLocation])

  // 2. React Effects
  useEffect(() => {
    const pId = localStorage.getItem('kiosk_project_id')
    if (!pId) {
      router.push('/login')
      return
    }

    // Schedule async to prevent synchronous setState in render
    const t = setTimeout(() => {
      setProjectId(pId)
      setIsOnline(navigator.onLine)
    }, 0)

    // Heartbeat setup
    const heartbeat = setInterval(() => {
      if (navigator.onLine && pId) {
        supabase.from('kiosk_accounts')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('project_id', pId)
          .then()
      }
    }, 30000)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearTimeout(t)
      clearInterval(heartbeat)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [router])

  useEffect(() => {
    if (projectId) {
      const t = setTimeout(() => {
        fetchProjectDetails()
        fetchWorkersAndLogs()
        updateQueueStats()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [projectId, fetchProjectDetails, fetchWorkersAndLogs, updateQueueStats])

  // Countdowns for Scanner
  useEffect(() => {
    if (!deadline || !isCameraActive) return
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setTimeRemaining(remaining)
      if (remaining <= 0) {
        stopScan()
        setErrorMsg('Batas waktu pemindaian 10 detik habis. Gunakan Fallback Manual jika perlu.')
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [deadline, isCameraActive, stopScan])

  // Realtime subscription setup
  useEffect(() => {
    if (!projectId) return
    const channel = supabase
      .channel('kiosk-logs')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          fetchWorkersAndLogs()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId, fetchWorkersAndLogs])

  // Cleanup stream on component unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-800 flex flex-col md:flex-row gap-6">
      {/* Kiosk Controls & Scan Panel */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-8 flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{projectName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-xs text-slate-500">{isOnline ? 'Online' : 'Offline Mode'}</span>
              {queuedCount > 0 && (
                <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-md font-medium">
                  {queuedCount} antrean
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => router.push('/kiosk/register')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition"
          >
            Registrasi Pekerja
          </button>
        </div>

        {errorMsg && (
          <div className="w-full mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        {statusMsg && (
          <div className="w-full mb-6 p-4 bg-emerald-50 text-emerald-700 text-sm rounded-lg border border-emerald-100">
            {statusMsg}
          </div>
        )}

        {!isCameraActive ? (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
            <button
              onClick={() => startScan('in')}
              className="py-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl font-bold text-2xl shadow-sm transition duration-200"
            >
              Absen MASUK
            </button>
            <button
              onClick={() => startScan('out')}
              className="py-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-2xl shadow-sm transition duration-200"
            >
              Absen PULANG
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center">
            <div className="text-center mb-4">
              <span className="text-lg font-semibold block">Memindai untuk Absen {scanMode === 'in' ? 'Masuk' : 'Pulang'}</span>
              <span className="text-sm text-slate-400">Sisa Waktu: {timeRemaining} Detik</span>
            </div>

            <div className="relative aspect-video w-full max-w-lg bg-black rounded-2xl overflow-hidden mb-6">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            </div>

            <div className="flex gap-4 w-full max-w-lg">
              <button
                onClick={triggerFaceMatch}
                className="flex-1 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl transition"
              >
                Cocokkan Wajah
              </button>
              <button
                onClick={() => setShowManualSelection(true)}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition"
              >
                Manual Fallback
              </button>
              <button
                onClick={stopScan}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition"
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {/* Fallback Manual Modal */}
        {showManualSelection && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Pilih Pekerja (Absen Manual)</h3>
              <select
                className="w-full p-2.5 border border-slate-200 rounded-lg text-slate-800 mb-4 focus:outline-none"
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
              >
                <option value="">Pilih Pekerja...</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.nik})</option>
                ))}
              </select>
              <div className="flex gap-4">
                <button
                  onClick={handleManualFallback}
                  disabled={!selectedWorkerId}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50"
                >
                  Konfirmasi Absen
                </button>
                <button
                  onClick={() => {
                    setShowManualSelection(false)
                    setSelectedWorkerId('')
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Log Hari Ini */}
      <div className="w-full md:w-80 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Log Absensi Hari Ini</h2>
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">Belum ada absensi hari ini.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex flex-col">
                <div className="flex justify-between items-start">
                  <span className="font-semibold text-sm text-slate-850 truncate">{log.name}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    log.type === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {log.type === 'in' ? 'MASUK' : 'PULANG'}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2 text-xs text-slate-400">
                  <span>{new Date(log.occurred_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="italic uppercase text-[9px]">{log.source}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
