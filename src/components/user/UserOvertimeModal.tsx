'use client'

import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { UserWorker } from '@/types/user'
import { blobToBase64, compressEvidenceImage } from '@/lib/image-compression'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSubmitted: (message: string) => void
  projectId: string
  projectName: string
  workers: UserWorker[]
}

export default function UserOvertimeModal({ isOpen, onClose, onSubmitted, projectId, projectName, workers }: Props) {
  const [workDate, setWorkDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }))
  const [hours, setHours] = useState(1.5)
  const [workerIds, setWorkerIds] = useState<string[]>([])
  const [evidence, setEvidence] = useState<File[]>([])
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const closeModal = () => {
    setWorkDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }))
    setHours(1.5)
    setWorkerIds([])
    setEvidence([])
    setDescription('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!navigator.onLine) return setError('Pengajuan lembur memerlukan koneksi internet.')
    if (!workDate || workerIds.length === 0) return setError('Tanggal dan minimal satu pekerja wajib dipilih.')

    setSubmitting(true)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (sessionError || !token) throw new Error('Sesi tidak valid. Silakan login ulang.')
      const evidenceBase64 = await Promise.all(evidence.map(async file => blobToBase64(await compressEvidenceImage(file))))
      const response = await fetch('/api/overtime-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId, workDate, hours, workerIds, evidenceBase64, description: description.trim() || undefined })
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Gagal mengirim pengajuan lembur')
      onSubmitted('Pengajuan lembur berhasil dikirim dan menunggu persetujuan admin.')
      closeModal()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Gagal mengirim pengajuan lembur')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div><h2 className="text-lg font-bold text-slate-900">Pengajuan Lembur</h2><p className="text-xs text-slate-500">{projectName}</p></div>
          <button type="button" onClick={closeModal} disabled={submitting} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {error && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">Tanggal Lembur
              <input type="date" required value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
            </label>
            <label className="text-sm font-semibold text-slate-700">Jumlah Jam
              <input type="number" min="0.5" max="24" step="0.5" required value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Keterangan (opsional)
            <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="Contoh: penyelesaian pengecoran area A" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
          </label>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-slate-700">Pekerja Aktif</span><span className="text-xs text-slate-500">{workerIds.length} dipilih</span></div>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {workers.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Tidak ada pekerja aktif.</p> : workers.map((worker) => (
                <label key={worker.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={workerIds.includes(worker.id)} onChange={() => setWorkerIds((ids) => ids.includes(worker.id) ? ids.filter((id) => id !== worker.id) : [...ids, worker.id])} />
                  <span className="text-sm text-slate-700"><strong>{worker.name}</strong> ({worker.nik})</span>
                </label>
              ))}
            </div>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Foto Bukti (opsional, maksimal 5)
            <span className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-normal text-slate-500"><Camera className="h-4 w-4" />{evidence.length ? `${evidence.length} foto dipilih` : 'Ambil foto atau pilih beberapa file'}</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setEvidence(Array.from(e.target.files || []).slice(0, 5))} className="mt-2 w-full text-xs text-slate-500" />
          </label>
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={closeModal} disabled={submitting} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700">Batal</button>
            <button type="submit" disabled={submitting || workers.length === 0} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Mengirim...' : 'Kirim Pengajuan'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
