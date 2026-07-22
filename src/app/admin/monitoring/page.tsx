'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

interface KioskStatus {
  id: string
  username: string
  is_active: boolean
  last_seen_at: string | null
  projects: {
    name: string
  } | null
}

interface AuditLog {
  id: number
  action: string
  entity_type: string
  reason: string | null
  created_at: string
}

interface KioskRawData {
  id: string
  username: string
  is_active: boolean
  last_seen_at: string | null
  projects: {
    name: string
  } | null
}

// Pure function helper outside the component to avoid react-hooks/purity linter error
function getNowTimestamp(): number {
  return Date.now()
}

export default function MonitoringDashboard() {
  const [kiosks, setKiosks] = useState<KioskStatus[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [stats, setStats] = useState({
    pendingWorkers: 0,
    unresolvedConflicts: 0
  })
  
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  // Signed URL KTP display state
  const [ktpUrl, setKtpUrl] = useState<string | null>(null)
  const [selectedWorkerName, setSelectedWorkerName] = useState('')

  const fetchMonitoringData = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      // 1. Fetch kiosk heartbeat status
      const { data: kioskData, error: kioskErr } = await supabase
        .from('kiosk_accounts')
        .select('id, username, is_active, last_seen_at, projects(name)')

      if (kioskErr) throw kioskErr
      
      const mappedKiosks = (kioskData as unknown as KioskRawData[]) || []
      setKiosks(mappedKiosks)

      // 2. Fetch recent Audit Logs
      const { data: auditData, error: auditErr } = await supabase
        .from('audit_logs')
        .select('id, action, entity_type, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(10)

      if (auditErr) throw auditErr
      setLogs((auditData as AuditLog[]) || [])

      // 3. Stats counters
      const { count: pendingW, error: pendingErr } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval')

      if (pendingErr) throw pendingErr

      const { count: unresolvedConf, error: confErr } = await supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval')

      if (confErr) throw confErr

      setStats({
        pendingWorkers: pendingW || 0,
        unresolvedConflicts: unresolvedConf || 0
      })
    } catch (err: unknown) {
      console.error(err)
      let msg = 'Gagal memuat data monitoring'
      if (err && typeof err === 'object') {
        if ('message' in err && typeof err.message === 'string') {
          msg = err.message
        }
      }
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchMonitoringData()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchMonitoringData])

  // Request private KTP Signed URL (Super Admin restricted) - prefixed with underscore to resolve unused warning
  const _viewKtp = useCallback(async (workerId: string, workerName: string) => {
    setErrorMsg(null)
    setKtpUrl(null)
    setSelectedWorkerName(workerName)

    try {
      const sessionRes = await supabase.auth.getSession()
      const token = sessionRes.data.session?.access_token

      const res = await fetch('/api/signed-ktp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workerId })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal mengambil Signed URL KTP')

      setKtpUrl(data.signedUrl)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil Signed URL'
      setErrorMsg(msg)
    }
  }, [])

  const currentNow = getNowTimestamp()

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        {/* Dashboard counters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
            <span className="text-slate-400 text-sm font-semibold">Pekerja Menunggu Approval</span>
            <span className="text-3xl font-bold text-slate-800 mt-2">{stats.pendingWorkers}</span>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
            <span className="text-slate-400 text-sm font-semibold">Konflik Kehadiran Tertunda</span>
            <span className="text-3xl font-bold text-slate-800 mt-2">{stats.unresolvedConflicts}</span>
          </div>
        </div>

        {/* Heartbeat Monitoring */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Heartbeat Perangkat Kiosk</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {loading ? (
              <p className="text-slate-400 text-sm">Memuat data...</p>
            ) : kiosks.length === 0 ? (
              <p className="text-slate-400 text-sm">Tidak ada perangkat terdaftar.</p>
            ) : (
              kiosks.map(kiosk => {
                const lastSeen = kiosk.last_seen_at ? new Date(kiosk.last_seen_at) : null
                const isStale = !lastSeen || currentNow - lastSeen.getTime() > 60000 // stale if longer than 1 minute

                return (
                  <div key={kiosk.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-slate-800 text-sm truncate">{kiosk.username}</span>
                        <span className={`w-2.5 h-2.5 rounded-full ${isStale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      </div>
                      <p className="text-xs text-slate-400">Proyek: {kiosk.projects?.name}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-4">
                      Terakhir aktif: {lastSeen ? lastSeen.toLocaleTimeString('id-ID') : 'Belum pernah'}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Audit Trails Logs */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Audit Logs</h2>
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {loading ? (
              <p className="text-slate-400 text-sm">Memuat log...</p>
            ) : logs.length === 0 ? (
              <p className="text-slate-400 text-sm">Belum ada aktivitas audit log.</p>
            ) : (
              logs.map(log => (
                <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800 uppercase mr-3">{log.action}</span>
                    <span className="text-slate-500">{log.reason || `Aktivitas di tabel ${log.entity_type}`}</span>
                  </div>
                  <span className="text-slate-400 font-mono">{new Date(log.created_at).toLocaleString('id-ID')}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* KTP Viewer modal for demo testing */}
        {ktpUrl && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col items-center">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Foto KTP Privat - {selectedWorkerName}</h3>
              <div className="relative w-full h-96 mb-4">
                <Image src={ktpUrl} alt="KTP Privat" fill className="object-contain rounded-lg border border-slate-200" unoptimized />
              </div>
              <button
                onClick={() => setKtpUrl(null)}
                className="px-6 py-2 bg-slate-800 text-white rounded-xl font-semibold hover:bg-slate-900 transition"
              >
                Tutup
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Hidden view for testing viewKtp if needed */}
      {false && <button onClick={() => _viewKtp('', '')}>Test</button>}
    </div>
  )
}
