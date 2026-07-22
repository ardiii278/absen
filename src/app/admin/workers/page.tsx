'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Worker {
  id: string
  nik: string
  name: string
  position: 'TK' | 'KN' | null
  job_scope: string
  status: 'pending_approval' | 'approved' | 'rejected'
  profile_path: string
  ktp_private_path: string | null
  project_id: string
}

interface Project {
  id: string
  name: string
}

export default function WorkerApprovalPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [isRejecting, setIsRejecting] = useState(false)

  // Bulk Operations
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [targetProject, setTargetProject] = useState('')
  const [targetJobScope, setTargetJobScope] = useState('')
  const [projects, setProjects] = useState<Project[]>([])

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const { data, error } = await supabase
        .from('workers')
        .select('id, nik, name, position, job_scope, status, profile_path, ktp_private_path, project_id')
        .order('created_at', { ascending: false })

      if (error) throw error
      setWorkers((data as Worker[]) || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil data pekerja'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('projects').select('id, name')
      if (error) throw error
      setProjects((data as Project[]) || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil data proyek'
      console.error(msg)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchWorkers()
      fetchProjects()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchWorkers, fetchProjects])

  const handleApprove = async (worker: Worker) => {
    setErrorMsg(null)
    try {
      // Mock Descriptor Generation for Demo
      const dummyDescriptor = Array.from({ length: 128 }, () => Math.random())

      let ktpPrivatePath = worker.ktp_private_path

      // Move KTP Photo from temp to private bucket (using Supabase storage copy/move)
      if (worker.ktp_private_path) {
        const privatePath = `private/${worker.nik}_ktp.jpg`
        const { error: copyErr } = await supabase.storage
          .from('kiosk-photos')
          .copy(worker.ktp_private_path, privatePath)

        if (!copyErr) {
          // Delete temporary public file
          await supabase.storage.from('kiosk-photos').remove([worker.ktp_private_path])
          ktpPrivatePath = privatePath
        }
      }

      // Update worker status and descriptor, set is_active=true
      const { error: updateErr } = await supabase
        .from('workers')
        .update({
          status: 'approved',
          is_active: true,
          face_descriptor: dummyDescriptor,
          ktp_private_path: ktpPrivatePath
        })
        .eq('id', worker.id)

      if (updateErr) throw updateErr

      // Log to Audit Trail
      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'workers',
        entity_id: worker.id,
        action: 'APPROVED_WORKER',
        reason: 'Valid identitas dan descriptor wajah',
        new_data: { status: 'approved', is_active: true }
      })
      if (logErr) console.error('Gagal menulis audit log:', logErr.message)

      await fetchWorkers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyetujui pekerja'
      setErrorMsg(msg)
    }
  }

  const handleReject = async () => {
    if (!selectedWorker || !rejectReason) return
    setErrorMsg(null)
    try {
      const { error: updateErr } = await supabase
        .from('workers')
        .update({
          status: 'rejected',
          is_active: false
        })
        .eq('id', selectedWorker.id)

      if (updateErr) throw updateErr

      // Log Audit Trail
      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'workers',
        entity_id: selectedWorker.id,
        action: 'REJECTED_WORKER',
        reason: rejectReason,
        new_data: { status: 'rejected', is_active: false }
      })
      if (logErr) console.error('Gagal menulis audit log:', logErr.message)

      setIsRejecting(false)
      setSelectedWorker(null)
      setRejectReason('')
      await fetchWorkers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menolak pekerja'
      setErrorMsg(msg)
    }
  }

  const handleBulkTransfer = async () => {
    if (selectedWorkerIds.length === 0 || !targetProject) return
    setErrorMsg(null)
    try {
      const userRes = await supabase.auth.getUser()
      for (const id of selectedWorkerIds) {
        const originalWorker = workers.find(w => w.id === id)
        const { error } = await supabase
          .from('workers')
          .update({ project_id: targetProject })
          .eq('id', id)

        if (error) throw error

        const { error: logErr } = await supabase.from('audit_logs').insert({
          actor_id: userRes.data.user?.id || null,
          entity_type: 'workers',
          entity_id: id,
          action: 'BULK_TRANSFER_PROJECT',
          reason: `Pindah proyek massal ke ${targetProject}`,
          old_data: { project_id: originalWorker?.project_id },
          new_data: { project_id: targetProject }
        })
        if (logErr) console.error('Gagal menulis audit log:', logErr.message)
      }
      setSelectedWorkerIds([])
      await fetchWorkers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal melakukan transfer massal'
      setErrorMsg(msg)
    }
  }

  const handleBulkJobScope = async () => {
    if (selectedWorkerIds.length === 0 || !targetJobScope) return
    setErrorMsg(null)
    try {
      const userRes = await supabase.auth.getUser()
      for (const id of selectedWorkerIds) {
        const originalWorker = workers.find(w => w.id === id)
        const { error } = await supabase
          .from('workers')
          .update({ job_scope: targetJobScope })
          .eq('id', id)

        if (error) throw error

        const { error: logErr } = await supabase.from('audit_logs').insert({
          actor_id: userRes.data.user?.id || null,
          entity_type: 'workers',
          entity_id: id,
          action: 'BULK_UPDATE_JOBSCOPE',
          reason: `Ubah job scope massal ke ${targetJobScope}`,
          old_data: { job_scope: originalWorker?.job_scope },
          new_data: { job_scope: targetJobScope }
        })
        if (logErr) console.error('Gagal menulis audit log:', logErr.message)
      }
      setSelectedWorkerIds([])
      await fetchWorkers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah job scope massal'
      setErrorMsg(msg)
    }
  }

  const toggleSelectWorker = (id: string) => {
    setSelectedWorkerIds(prev =>
      prev.includes(id) ? prev.filter(wId => wId !== id) : [...prev, id]
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-800">Approval dan Kelola Pekerja</h1>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        {/* Bulk Actions Panel */}
        {selectedWorkerIds.length > 0 && (
          <div className="mb-6 p-4 bg-slate-100 rounded-xl flex flex-wrap gap-4 items-center justify-between">
            <span className="text-sm font-semibold">{selectedWorkerIds.length} Pekerja Terpilih</span>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <select
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none"
                  value={targetProject}
                  onChange={e => setTargetProject(e.target.value)}
                >
                  <option value="">Pilih Proyek...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkTransfer}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-medium transition"
                >
                  Transfer Proyek
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Job scope baru..."
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none text-slate-800"
                  value={targetJobScope}
                  onChange={e => setTargetJobScope(e.target.value)}
                />
                <button
                  onClick={handleBulkJobScope}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-medium transition"
                >
                  Ubah Job Scope
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                <th className="py-3 px-4 w-12">
                  <input
                    type="checkbox"
                    checked={selectedWorkerIds.length === workers.length && workers.length > 0}
                    onChange={() => {
                      if (selectedWorkerIds.length === workers.length) {
                        setSelectedWorkerIds([])
                      } else {
                        setSelectedWorkerIds(workers.map(w => w.id))
                      }
                    }}
                  />
                </th>
                <th className="py-3 px-4">NIK</th>
                <th className="py-3 px-4">Nama</th>
                <th className="py-3 px-4">Jabatan</th>
                <th className="py-3 px-4">Job Scope</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Memuat data...</td>
                </tr>
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Tidak ada data pekerja.</td>
                </tr>
              ) : (
                workers.map(worker => (
                  <tr key={worker.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedWorkerIds.includes(worker.id)}
                        onChange={() => toggleSelectWorker(worker.id)}
                      />
                    </td>
                    <td className="py-3 px-4 font-mono text-sm">{worker.nik}</td>
                    <td className="py-3 px-4 font-medium">{worker.name}</td>
                    <td className="py-3 px-4">{worker.position}</td>
                    <td className="py-3 px-4">{worker.job_scope}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        worker.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                        worker.status === 'rejected' ? 'bg-red-50 text-red-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {worker.status === 'approved' ? 'Aktif' :
                         worker.status === 'rejected' ? 'Ditolak' : 'Menunggu Approval'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {worker.status === 'pending_approval' && (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleApprove(worker)}
                            className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-medium transition"
                          >
                            Setujui
                          </button>
                          <button
                            onClick={() => {
                              setSelectedWorker(worker)
                              setIsRejecting(true)
                            }}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition"
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

        {/* Reject Dialog overlay */}
        {isRejecting && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Tolak Pendaftaran Pekerja</h3>
              <textarea
                className="w-full p-3 border border-slate-200 rounded-lg text-slate-850 focus:outline-none focus:ring-2 focus:ring-red-600 mb-4"
                placeholder="Alasan penolakan pendaftaran..."
                rows={4}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
              <div className="flex gap-4">
                <button
                  onClick={handleReject}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition"
                >
                  Tolak Pendaftaran
                </button>
                <button
                  onClick={() => {
                    setIsRejecting(false)
                    setSelectedWorker(null)
                    setRejectReason('')
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
    </div>
  )
}
