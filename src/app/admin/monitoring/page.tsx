'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { Users, UserCheck, Clock, DollarSign, Activity, X } from 'lucide-react'
import { AuditLog, DashboardStats } from '@/types'
import MetricCard from '@/components/ui/MetricCard'
import { AttendanceTypeBadge, SourceBadge } from '@/components/ui/StatusBadge'
import { useGlobalFilter } from '@/components/FilterContext'

interface LiveAttendance {
  id: string
  worker_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  source: string | null
  evidence_path: string | null
  workers: { name: string; nik: string; job_scope: string } | null
}

interface DashboardWorker {
  id: string
  name: string
  nik: string
  position: 'TK' | 'KN' | null
  job_scope: string
  project_id: string
  daily_wage: number
  projects: { name: string } | null
}

interface KioskStatus {
  id: string
  username: string
  is_active: boolean
  last_seen_at: string | null
  projects: { name: string } | null
}

export default function MonitoringDashboard() {
  const { projectId, jobScope } = useGlobalFilter()
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkersActive: 0,
    presentToday: 0,
    notYetAbsent: 0,
    overtimeToday: 0,
    estimatedWageToday: 0,
    pendingWorkers: 0,
    unresolvedConflicts: 0
  })
  const [liveAttendance, setLiveAttendance] = useState<LiveAttendance[]>([])
  const [kiosks, setKiosks] = useState<KioskStatus[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [activeWorkers, setActiveWorkers] = useState<DashboardWorker[]>([])
  const [detailView, setDetailView] = useState<'workers' | 'attendance' | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoTitle, setPhotoTitle] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]

      let workerQuery = supabase
        .from('workers')
        .select('id, name, nik, position, job_scope, project_id, daily_wage, projects(name)')
        .eq('is_active', true)
      if (projectId) workerQuery = workerQuery.eq('project_id', projectId)
      if (jobScope) workerQuery = workerQuery.eq('job_scope', jobScope)
      const { data: workerData, error: workerError } = await workerQuery.order('name')
      if (workerError) throw workerError
      const filteredWorkers = (workerData as unknown as DashboardWorker[]) || []
      const workerIds = filteredWorkers.map(worker => worker.id)

      let attendanceQuery = supabase
        .from('attendance')
        .select('id, worker_id, type, occurred_at, source, evidence_path, workers(name, nik, job_scope)')
        .gte('occurred_at', `${today}T00:00:00Z`)
        .lte('occurred_at', `${today}T23:59:59.999Z`)
      if (projectId) attendanceQuery = attendanceQuery.eq('project_id', projectId)
      attendanceQuery = workerIds.length
        ? attendanceQuery.in('worker_id', workerIds)
        : attendanceQuery.eq('worker_id', '00000000-0000-0000-0000-000000000000')

      let kioskQuery = supabase.from('kiosk_accounts').select('id, username, is_active, last_seen_at, project_id, projects(name)')
      if (projectId) kioskQuery = kioskQuery.eq('project_id', projectId)

      const [
        { count: pendingWorkers },
        { count: unresolvedConflicts },
        { data: todayAttendance },
        { data: kioskData },
        { data: auditData }
      ] = await Promise.all([
        supabase.from('workers').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
        supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
        attendanceQuery.order('occurred_at', { ascending: false }),
        kioskQuery,
        supabase.from('audit_logs')
          .select('id, actor_id, entity_type, entity_id, action, reason, old_data, new_data, created_at')
          .order('created_at', { ascending: false })
          .limit(10)
      ])

      const attendanceList = (todayAttendance as unknown as LiveAttendance[]) || []
      const uniquePresentWorkers = new Set(
        attendanceList.filter(a => a.type === 'in' && a.worker_id).map(a => a.worker_id as string)
      )
      const presentToday = uniquePresentWorkers.size
      const totalActive = filteredWorkers.length

      let overtimeQuery = supabase
        .from('overtime')
        .select('id', { count: 'exact', head: true })
        .eq('work_date', today)
        .eq('status', 'approved')
      if (projectId) overtimeQuery = overtimeQuery.eq('project_id', projectId)
      const { count: overtimeCount } = await overtimeQuery

      const estimatedWage = filteredWorkers
        .filter(worker => uniquePresentWorkers.has(worker.id))
        .reduce((sum, worker) => sum + Number(worker.daily_wage || 0), 0)

      setStats({
        totalWorkersActive: totalActive,
        presentToday,
        notYetAbsent: totalActive - presentToday,
        overtimeToday: overtimeCount || 0,
        estimatedWageToday: estimatedWage,
        pendingWorkers: pendingWorkers || 0,
        unresolvedConflicts: unresolvedConflicts || 0
      })

      setLiveAttendance(attendanceList)
      setActiveWorkers(filteredWorkers)
      setKiosks((kioskData as unknown as KioskStatus[]) || [])
      setLogs((auditData as AuditLog[]) || [])
    } catch (err) {
      console.error('Failed to fetch monitoring data:', err)
    } finally {
      setLoading(false)
    }
  }, [jobScope, projectId])

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setTimeout(() => {
      fetchData()
    }, 0)
    const interval = setInterval(() => {
      fetchData()
      setNow(Date.now())
    }, 15000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [fetchData])

  const showEvidence = async (record: LiveAttendance) => {
    if (!record.evidence_path) return
    const { data, error } = await supabase.storage
      .from('kiosk-photos')
      .createSignedUrl(record.evidence_path, 60)
    if (!error && data) {
      setPhotoTitle(`${record.workers?.name || 'Pekerja'} - ${new Date(record.occurred_at).toLocaleString('id-ID')}`)
      setPhotoUrl(data.signedUrl)
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ringkasan Hari Ini</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Statistik mengikuti pilihan lokasi dan proyek di atas. Klik kartu pekerja atau kehadiran untuk membuka rinciannya.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Pekerja Aktif" value={stats.totalWorkersActive} icon={Users} color="blue" loading={loading} onClick={() => setDetailView('workers')} />
        <MetricCard label="Hadir Hari Ini" value={`${stats.presentToday} / ${stats.presentToday + stats.notYetAbsent}`} icon={UserCheck} color="emerald" loading={loading} onClick={() => setDetailView('attendance')} />
        <MetricCard label="Lembur Hari Ini" value={stats.overtimeToday} icon={Clock} color="amber" loading={loading} />
        <MetricCard label="Estimasi Upah" value={`Rp ${stats.estimatedWageToday.toLocaleString('id-ID')}`} icon={DollarSign} color="slate" loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Absensi Terakhir Masuk/Pulang</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 text-xs font-semibold">
                  <th className="py-2 px-3">Pekerja</th>
                  <th className="py-2 px-3">Tipe</th>
                  <th className="py-2 px-3">Waktu</th>
                  <th className="py-2 px-3">Verifikasi</th>
                  <th className="py-2 px-3">Foto</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
                ) : liveAttendance.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400 text-sm">Belum ada absensi hari ini.</td></tr>
                ) : (
                  liveAttendance.slice(0, 10).map(record => (
                    <tr key={record.id} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-sm text-slate-800 dark:text-slate-200">{record.workers?.name}</div>
                        <div className="text-[10px] text-slate-400">{record.workers?.job_scope || record.workers?.nik}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <AttendanceTypeBadge type={record.type || 'in'} />
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-slate-600 dark:text-slate-400">
                        {new Date(record.occurred_at).toLocaleTimeString('id-ID')}
                      </td>
                      <td className="py-2.5 px-3">
                        <SourceBadge source={record.source} />
                      </td>
                      <td className="py-2.5 px-3">
                        {record.evidence_path ? (
                          <button onClick={() => showEvidence(record)} className="text-xs font-semibold text-blue-600 hover:underline">Lihat</button>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 inline-block" title="Tanpa foto" />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Heartbeat Kiosk</h2>
            <div className="space-y-3">
              {loading ? (
                <p className="text-slate-400 text-xs">Memuat...</p>
              ) : kiosks.length === 0 ? (
                <p className="text-slate-400 text-xs">Tidak ada perangkat.</p>
              ) : (
                kiosks.map(kiosk => {
                  const lastSeen = kiosk.last_seen_at ? new Date(kiosk.last_seen_at) : null
                  const isStale = !lastSeen || now - lastSeen.getTime() > 60000
                  return (
                    <div key={kiosk.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                      <div>
                        <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">{kiosk.username}</span>
                        <p className="text-[10px] text-slate-400">{kiosk.projects?.name}</p>
                      </div>
                      <span className={`w-2.5 h-2.5 rounded-full ${isStale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Audit Log Terbaru</h2>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {loading ? (
                <p className="text-slate-400 text-xs">Memuat...</p>
              ) : logs.length === 0 ? (
                <p className="text-slate-400 text-xs">Belum ada log.</p>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-[10px]">
                    <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">{log.action}</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">{log.reason || log.entity_type}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {detailView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {detailView === 'workers' ? 'Daftar Pekerja Aktif' : 'Kehadiran Hari Ini'}
                </h3>
                <p className="text-xs text-slate-500">Mengikuti filter lokasi dan proyek pada topbar.</p>
              </div>
              <button onClick={() => setDetailView(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            {detailView === 'workers' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b text-xs text-slate-400"><th className="p-3">Nama</th><th className="p-3">NIK</th><th className="p-3">Jabatan</th><th className="p-3">Lokasi</th><th className="p-3">Proyek</th></tr></thead>
                  <tbody>{activeWorkers.map(worker => (
                    <tr key={worker.id} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{worker.name}</td>
                      <td className="p-3 font-mono text-xs">{worker.nik}</td>
                      <td className="p-3">{worker.position || '-'}</td>
                      <td className="p-3">{worker.projects?.name || '-'}</td>
                      <td className="p-3">{worker.job_scope || '-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b text-xs text-slate-400"><th className="p-3">Pekerja</th><th className="p-3">Tipe</th><th className="p-3">Waktu</th><th className="p-3">Metode</th><th className="p-3">Foto</th></tr></thead>
                  <tbody>{liveAttendance.map(record => (
                    <tr key={record.id} className="border-b border-slate-100">
                      <td className="p-3"><div className="font-semibold">{record.workers?.name}</div><div className="text-xs text-slate-400">{record.workers?.job_scope}</div></td>
                      <td className="p-3"><AttendanceTypeBadge type={record.type || 'in'} /></td>
                      <td className="p-3">{new Date(record.occurred_at).toLocaleString('id-ID')}</td>
                      <td className="p-3"><SourceBadge source={record.source} /></td>
                      <td className="p-3">{record.evidence_path ? <button onClick={() => showEvidence(record)} className="font-semibold text-blue-600 hover:underline">Lihat Foto</button> : '-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {photoUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-800">{photoTitle}</h3><button onClick={() => setPhotoUrl(null)}><X className="h-5 w-5" /></button></div>
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black"><Image src={photoUrl} alt="Bukti absensi" fill className="object-contain" unoptimized /></div>
          </div>
        </div>
      )}
    </div>
  )
}
