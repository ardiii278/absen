'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

interface Worker {
  id: string
  name: string
  nik: string
  project_id: string
}

interface OvertimeRecord {
  id: string
  project_id: string
  work_date: string
  hours: number | null
  status: 'pending_approval' | 'approved' | 'rejected'
  evidence_path: string | null
  projects: {
    name: string
  } | null
  overtime_workers: { worker_id: string; hours: number }[]
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
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Creation State
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [hours, setHours] = useState(1.5)
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)

  // Edit State
  const [editingOvertime, setEditingOvertime] = useState<OvertimeRecord | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editWorkDate, setEditWorkDate] = useState('')
  const [editHours, setEditHours] = useState(1.5)
  const [editWorkerIds, setEditWorkerIds] = useState<string[]>([])
  const [editLoading, setEditLoading] = useState(false)

  // Preview State
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('')

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
        .select('id, project_id, work_date, hours, status, evidence_path, projects(name), overtime_workers(worker_id, hours)')
        .order('work_date', { ascending: false })

      if (otErr) throw otErr
      
      const records = (otData as unknown as OvertimeRecord[]) || []
      setOvertimes(records)
    } catch (err: unknown) {
      let msg = 'Gagal memuat data'
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        msg = err.message
      }
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
    setSuccessMsg(null)

    if (!selectedProjectId || !workDate || selectedWorkerIds.length === 0) {
      setErrorMsg('Semua field wajib diisi termasuk checklist pekerja.')
      return
    }

    setSubmitLoading(true)
    try {
      const userRes = await supabase.auth.getUser()
      if (userRes.error) throw userRes.error

      let evidencePath = null
      if (evidenceFile) {
        const fileExt = evidenceFile.name.split('.').pop()
        const fileName = `${crypto.randomUUID()}.${fileExt}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('kiosk-photos')
          .upload(`overtime/${fileName}`, evidenceFile)

        if (uploadErr) {
          throw new Error('Gagal mengunggah foto bukti lembur: ' + uploadErr.message)
        }
        evidencePath = uploadData?.path || null
      }

      // 1. Create Overtime entry
      const { data: otData, error: otErr } = await supabase
        .from('overtime')
        .insert({
          project_id: selectedProjectId,
          work_date: workDate,
          hours: hours,
          evidence_path: evidencePath,
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
      if (mapErr) {
        // Rollback uploaded file if DB insert fails
        if (evidencePath) {
          await supabase.storage.from('kiosk-photos').remove([evidencePath])
        }
        throw mapErr
      }

      // 3. Log to Audit
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'overtime',
        entity_id: otData.id,
        action: 'CREATED_OVERTIME_REQUEST',
        reason: `Pengajuan lembur ${hours} jam`,
        new_data: { work_date: workDate, hours, workers: selectedWorkerIds, evidence_path: evidencePath }
      })
      if (logErr) console.error('Gagal menulis audit log:', logErr.message)

      // Reset form
      setSelectedWorkerIds([])
      setWorkDate('')
      setEvidenceFile(null)
      // Reset input element
      const fileInput = document.getElementById('evidence_file_input') as HTMLInputElement
      if (fileInput) fileInput.value = ''

      setSuccessMsg('Pengajuan lembur berhasil dikirim.')
      await fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat lembur'
      setErrorMsg(msg)
    } finally {
      setSubmitLoading(false)
    }
  }

  const handleApproveOvertime = async (id: string, status: 'approved' | 'rejected') => {
    setErrorMsg(null)
    setSuccessMsg(null)
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

      setSuccessMsg(`Pengajuan lembur berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}.`)
      await fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses approval lembur'
      setErrorMsg(msg)
    }
  }

  const handlePreviewPhoto = async (record: OvertimeRecord) => {
    if (!record.evidence_path) return
    setPreviewPhotoUrl(null)
    setPreviewTitle(`Foto Bukti Lembur - ${record.projects?.name} (${new Date(record.work_date).toLocaleDateString('id-ID')})`)
    try {
      const { data, error } = await supabase.storage
        .from('kiosk-photos')
        .createSignedUrl(record.evidence_path, 60)

      if (error) throw error
      if (data) setPreviewPhotoUrl(data.signedUrl)
    } catch (err) {
      console.error('Gagal memuat foto bukti:', err)
      setErrorMsg('Gagal memuat foto bukti lembur.')
    }
  }

  const openEditModal = (record: OvertimeRecord) => {
    setEditingOvertime(record)
    setEditProjectId(record.project_id)
    setEditWorkDate(record.work_date)
    setEditHours(record.hours || 0.5)
    setEditWorkerIds(record.overtime_workers.map((mapping) => mapping.worker_id))
    setErrorMsg(null)
  }

  const handleEditOvertime = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingOvertime || !editProjectId || !editWorkDate || editWorkerIds.length === 0 || editHours < 0.5) {
      setErrorMsg('Semua field edit wajib diisi termasuk checklist pekerja.')
      return
    }
    const validWorkerIds = new Set(workers.filter((worker) => worker.project_id === editProjectId).map((worker) => worker.id))
    if (editWorkerIds.some((id) => !validWorkerIds.has(id))) {
      setErrorMsg('Pekerja yang dipilih harus aktif dan berasal dari proyek tujuan.')
      return
    }

    setEditLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    const oldData = {
      project_id: editingOvertime.project_id,
      work_date: editingOvertime.work_date,
      hours: editingOvertime.hours,
      workers: editingOvertime.overtime_workers.map((mapping) => mapping.worker_id)
    }
    const newData = { project_id: editProjectId, work_date: editWorkDate, hours: editHours, workers: editWorkerIds }

    try {
      const { error: updateError } = await supabase.from('overtime').update({
        project_id: editProjectId,
        work_date: editWorkDate,
        hours: editHours
      }).eq('id', editingOvertime.id)
      if (updateError) throw updateError

      const { error: deleteError } = await supabase.from('overtime_workers').delete().eq('overtime_id', editingOvertime.id)
      if (deleteError) throw deleteError
      const { error: insertError } = await supabase.from('overtime_workers').insert(
        editWorkerIds.map((workerId) => ({ overtime_id: editingOvertime.id, worker_id: workerId, hours: editHours }))
      )
      if (insertError) throw insertError

      const userRes = await supabase.auth.getUser()
      if (userRes.error) throw userRes.error
      const { error: logError } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'overtime',
        entity_id: editingOvertime.id,
        action: 'UPDATED_OVERTIME_REQUEST',
        reason: 'Perubahan detail pengajuan lembur',
        old_data: oldData,
        new_data: newData
      })
      if (logError) throw logError

      setEditingOvertime(null)
      setSuccessMsg('Pengajuan lembur berhasil diperbarui.')
      await fetchData()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui pengajuan lembur')
    } finally {
      setEditLoading(false)
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

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-100">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleCreateOvertime} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Proyek</label>
            <select
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
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
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
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
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Foto Bukti Lembur</label>
            <input
              id="evidence_file_input"
              type="file"
              accept="image/jpeg,image/png"
              className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  setEvidenceFile(e.target.files[0])
                }
              }}
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
            disabled={submitLoading}
            className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            {submitLoading ? 'Mengirim...' : 'Kirim Pengajuan'}
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
                <th className="py-3 px-4">Bukti Foto</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">Memuat data...</td>
                </tr>
              ) : overtimes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">Belum ada pengajuan lembur.</td>
                </tr>
              ) : (
                overtimes.map(ot => (
                  <tr key={ot.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-semibold text-sm">{ot.projects?.name}</td>
                    <td className="py-3 px-4 text-sm">{new Date(ot.work_date).toLocaleDateString('id-ID')}</td>
                    <td className="py-3 px-4 font-medium">{ot.hours} Jam</td>
                    <td className="py-3 px-4">
                      {ot.evidence_path ? (
                        <button
                          onClick={() => handlePreviewPhoto(ot)}
                          className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-semibold transition"
                        >
                          Lihat Foto
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Tidak ada</span>
                      )}
                    </td>
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
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEditModal(ot)} className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition">Edit</button>
                        {ot.status === 'pending_approval' && (
                          <>
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PHOTO PREVIEW MODAL */}
      {previewPhotoUrl && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col items-center">
            <h3 className="text-lg font-bold text-slate-800 mb-4">{previewTitle}</h3>
            <div className="relative w-full aspect-video mb-4 rounded-xl overflow-hidden border border-slate-200">
              <Image src={previewPhotoUrl} alt="Bukti Lembur" fill className="object-contain" unoptimized />
            </div>
            <button
              onClick={() => setPreviewPhotoUrl(null)}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-semibold transition"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {editingOvertime && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6">
            <h3 className="mb-5 text-lg font-bold text-slate-900">Edit Pengajuan Lembur</h3>
            <form onSubmit={handleEditOvertime} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">Proyek
                <select value={editProjectId} onChange={(e) => { setEditProjectId(e.target.value); setEditWorkerIds([]) }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">Pilih Proyek...</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">Tanggal Lembur
                  <input type="date" value={editWorkDate} onChange={(e) => setEditWorkDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Jumlah Jam
                  <input type="number" min="0.5" max="24" step="0.5" value={editHours} onChange={(e) => setEditHours(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>
              <div>
                <span className="mb-2 block text-xs font-semibold text-slate-700">Pekerja Aktif</span>
                <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                  {workers.filter((worker) => worker.project_id === editProjectId).map((worker) => (
                    <label key={worker.id} className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={editWorkerIds.includes(worker.id)} onChange={() => setEditWorkerIds((ids) => ids.includes(worker.id) ? ids.filter((id) => id !== worker.id) : [...ids, worker.id])} />
                      {worker.name} ({worker.nik})
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" disabled={editLoading} onClick={() => setEditingOvertime(null)} className="rounded-xl bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-700">Batal</button>
                <button type="submit" disabled={editLoading} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{editLoading ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
