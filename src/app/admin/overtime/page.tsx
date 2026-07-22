'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Worker {
  id: string
  name: string
  nik: string
  project_id: string
}

interface OvertimeRecord {
  id: string
  work_date: string
  hours: number | null
  status: 'pending_approval' | 'approved' | 'rejected'
  projects: {
    name: string
  } | null
}

interface Project {
  id: string
  name: string
}

export default function OvertimePage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [overtimes, setOvertimes] = useState<OvertimeRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Creation State
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [hours, setHours] = useState(1.5)
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const { data: projData, error: projErr } = await supabase.from('projects').select('id, name')
      if (projErr) throw projErr
      setProjects((projData as Project[]) || [])

      const { data: wData, error: wErr } = await supabase.from('workers').select('id, name, nik, project_id').eq('is_active', true)
      if (wErr) throw wErr
      setWorkers((wData as Worker[]) || [])

      const { data: otData, error: otErr } = await supabase
        .from('overtime')
        .select('id, work_date, hours, status, projects(name)')
        .order('work_date', { ascending: false })

      if (otErr) throw otErr
      
      const records = (otData as unknown as OvertimeRecord[]) || []
      setOvertimes(records)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchData()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchData])

  const handleCreateOvertime = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!selectedProjectId || !workDate || selectedWorkerIds.length === 0) {
      setErrorMsg('Semua field wajib diisi termasuk checklist pekerja.')
      return
    }

    try {
      const userRes = await supabase.auth.getUser()
      if (userRes.error) throw userRes.error

      // 1. Create Overtime entry
      const { data: otData, error: otErr } = await supabase
        .from('overtime')
        .insert({
          project_id: selectedProjectId,
          work_date: workDate,
          hours: hours,
          status: 'pending_approval',
          created_by: userRes.data.user?.id || null
        })
        .select()
        .single()

      if (otErr || !otData) throw otErr || new Error('Gagal membuat pengajuan lembur')

      // 2. Map workers to overtime
      const mappings = selectedWorkerIds.map(wId => ({
        overtime_id: otData.id,
        worker_id: wId,
        hours: hours
      }))

      const { error: mapErr } = await supabase.from('overtime_workers').insert(mappings)
      if (mapErr) throw mapErr

      // 3. Log to Audit
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'overtime',
        entity_id: otData.id,
        action: 'CREATED_OVERTIME_REQUEST',
        reason: `Pengajuan lembur ${hours} jam`,
        new_data: { work_date: workDate, hours, workers: selectedWorkerIds }
      })
      if (logErr) console.error('Gagal menulis audit log:', logErr.message)

      // Reset
      setSelectedWorkerIds([])
      setWorkDate('')
      await fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat lembur'
      setErrorMsg(msg)
    }
  }

  const handleApproveOvertime = async (id: string, status: 'approved' | 'rejected') => {
    setErrorMsg(null)
    try {
      const { error } = await supabase.from('overtime').update({ status }).eq('id', id)
      if (error) throw error

      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'overtime',
        entity_id: id,
        action: `DECIDED_OVERTIME_${status.toUpperCase()}`,
        reason: `Persetujuan lembur diset/ditolak`,
        new_data: { status }
      })
      if (logErr) console.error('Gagal menulis audit log:', logErr.message)

      await fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses approval lembur'
      setErrorMsg(msg)
    }
  }

  const toggleWorkerSelection = (id: string) => {
    setSelectedWorkerIds(prev =>
      prev.includes(id) ? prev.filter(wId => wId !== id) : [...prev, id]
    )
  }

  const filteredWorkers = workers.filter(w => w.project_id === selectedProjectId)

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800 flex flex-col lg:flex-row gap-8">
      {/* Create Overtime Request Form */}
      <div className="w-full lg:w-96 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 self-start">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Pengajuan Lembur Massal</h2>
        
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleCreateOvertime} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Proyek</label>
            <select
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-850 focus:outline-none"
              value={selectedProjectId}
              onChange={e => {
                setSelectedProjectId(e.target.value)
                setSelectedWorkerIds([])
              }}
            >
              <option value="">Pilih Proyek...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tanggal Lembur</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-850 focus:outline-none"
              value={workDate}
              onChange={e => setWorkDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Jumlah Jam</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-850 focus:outline-none"
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
            />
          </div>

          {selectedProjectId && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Checklist Pekerja Aktif</label>
              <div className="border border-slate-100 rounded-lg max-h-48 overflow-y-auto p-3 space-y-2">
                {filteredWorkers.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center">Tidak ada pekerja aktif di proyek ini.</p>
                ) : (
                  filteredWorkers.map(w => (
                    <label key={w.id} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedWorkerIds.includes(w.id)}
                        onChange={() => toggleWorkerSelection(w.id)}
                      />
                      <span>{w.name} ({w.nik})</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition"
          >
            Kirim Pengajuan
          </button>
        </form>
      </div>

      {/* Overtime Request Records */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-800 font-sans">Daftar Pengajuan Lembur</h1>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                <th className="py-3 px-4">Proyek</th>
                <th className="py-3 px-4">Tanggal Kerja</th>
                <th className="py-3 px-4">Jam Lembur</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">Memuat data...</td>
                </tr>
              ) : overtimes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">Belum ada pengajuan lembur.</td>
                </tr>
              ) : (
                overtimes.map(ot => (
                  <tr key={ot.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-semibold text-sm">{ot.projects?.name}</td>
                    <td className="py-3 px-4 text-sm">{new Date(ot.work_date).toLocaleDateString('id-ID')}</td>
                    <td className="py-3 px-4 font-medium">{ot.hours} Jam</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        ot.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                        ot.status === 'rejected' ? 'bg-red-50 text-red-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {ot.status === 'approved' ? 'Disetujui' :
                         ot.status === 'rejected' ? 'Ditolak' : 'Menunggu Approval'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {ot.status === 'pending_approval' && (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleApproveOvertime(ot.id, 'approved')}
                            className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs transition"
                          >
                            Setujui
                          </button>
                          <button
                            onClick={() => handleApproveOvertime(ot.id, 'rejected')}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition"
                          >
                            Tolak
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
