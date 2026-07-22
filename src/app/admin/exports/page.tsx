'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Project {
  id: string
  name: string
}

type DateRangePreset = 'custom' | 'today' | 'week' | 'month'

export default function ExportsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [activePreset, setActivePreset] = useState<DateRangePreset>('custom')

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const [backupVerified, setBackupVerified] = useState(false)
  const [purgeStats, setPurgeStats] = useState({ count: 0 })

  useEffect(() => {
    supabase.from('projects').select('id, name')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((res: any) => {
        setProjects((res.data as Project[]) || [])
      })
  }, [])

  const applyPreset = (preset: DateRangePreset) => {
    setActivePreset(preset)
    const now = new Date()
    const today = now.toISOString().split('T')[0]

    if (preset === 'today') {
      setStartDate(today)
      setEndDate(today)
    } else if (preset === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      setStartDate(weekAgo.toISOString().split('T')[0])
      setEndDate(today)
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(firstDay.toISOString().split('T')[0])
      setEndDate(today)
    }
  }

  const handleDateChange = (field: 'start' | 'end', value: string) => {
    setActivePreset('custom')
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  const getToken = async () => {
    const sessionRes = await supabase.auth.getSession()
    return sessionRes.data.session?.access_token
  }

  const handleExportExcel = async () => {
    if (!selectedProjectId || !startDate || !endDate) return
    setLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: selectedProjectId, startDate, endDate })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal ekspor Excel')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rekap_absen_${selectedProjectId}_${startDate}_${endDate}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setSuccessMsg('Rekap Excel berhasil diunduh.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal ekspor Excel'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleExportDaily = async () => {
    if (!selectedProjectId || !startDate || !endDate) return
    setLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/export-daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: selectedProjectId, startDate, endDate })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal ekspor absen harian')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `absen_harian_${selectedProjectId}_${startDate}_${endDate}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setSuccessMsg('Absen harian dengan foto berhasil diunduh.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal ekspor absen harian'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleBackupZip = async () => {
    if (!selectedProjectId || !startDate || !endDate) return
    setLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: selectedProjectId, startDate, endDate })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal ekspor ZIP')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup_bukti_${selectedProjectId}_${startDate}_${endDate}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()

      setBackupVerified(true)
      setSuccessMsg('Backup ZIP berhasil diunduh dan terverifikasi.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal ekspor ZIP'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const previewPurge = useCallback(async () => {
    if (!selectedProjectId || !startDate || !endDate) return
    setErrorMsg(null)
    setSuccessMsg(null)
    
    const { count, error } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', selectedProjectId)
      .gte('occurred_at', `${startDate}T00:00:00Z`)
      .lte('occurred_at', `${endDate}T23:59:59.999Z`)
      .not('evidence_path', 'is', null)

    if (error) {
      setErrorMsg(error.message)
    } else {
      setPurgeStats({ count: count || 0 })
      setShowPurgeConfirm(true)
    }
  }, [selectedProjectId, startDate, endDate])

  const handlePurge = async () => {
    if (!backupVerified) {
      setErrorMsg('Purge ditolak: Unduh dan verifikasi Backup ZIP terlebih dahulu.')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const { data: records, error: fetchErr } = await supabase
        .from('attendance')
        .select('id, evidence_path')
        .eq('project_id', selectedProjectId)
        .gte('occurred_at', `${startDate}T00:00:00Z`)
        .lte('occurred_at', `${endDate}T23:59:59.999Z`)
        .not('evidence_path', 'is', null)

      if (fetchErr) throw fetchErr

      const rawRecords = (records as { id: string; evidence_path: string | null }[]) || []

      if (rawRecords.length > 0) {
        const filePaths = rawRecords.map((r) => r.evidence_path).filter((p): p is string => !!p)
        
        const { error: storageErr } = await supabase.storage
          .from('kiosk-photos')
          .remove(filePaths)

        if (storageErr) throw storageErr

        for (const record of rawRecords) {
          const { error: updateErr } = await supabase
            .from('attendance')
            .update({ evidence_path: null })
            .eq('id', record.id)
          if (updateErr) throw updateErr
        }
      }

      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'projects',
        entity_id: selectedProjectId,
        action: 'PURGED_STORAGE_EVIDENCE',
        reason: `Pembersihan penyimpanan foto absensi periode ${startDate} - ${endDate}`
      })
      if (logErr) console.error('Gagal menyimpan audit log:', logErr.message)

      setSuccessMsg('Pembersihan storage selesai. Data teks absensi tetap dipertahankan.')
      setShowPurgeConfirm(false)
      setBackupVerified(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membersihkan storage'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const isDisabled = !selectedProjectId || !startDate || !endDate || loading

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-850">Ekspor, Backup, dan Retensi Data</h1>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 text-sm rounded-lg border border-emerald-100">
            {successMsg}
          </div>
        )}

        {/* Project Selection */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-slate-700 mb-1">Proyek</label>
          <select
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
          >
            <option value="">Pilih Proyek...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Quick Date Range Presets */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-slate-700 mb-2">Pilih Periode</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => applyPreset('today')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activePreset === 'today'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Hari Ini
            </button>
            <button
              onClick={() => applyPreset('week')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activePreset === 'week'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              7 Hari Terakhir
            </button>
            <button
              onClick={() => applyPreset('month')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activePreset === 'month'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Bulan Ini
            </button>
            <button
              onClick={() => { setStartDate(''); setEndDate(''); setActivePreset('custom') }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activePreset === 'custom' && (!startDate || !endDate)
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Manual Date Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Tanggal Mulai</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
              value={startDate}
              onChange={e => handleDateChange('start', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Tanggal Selesai</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none"
              value={endDate}
              onChange={e => handleDateChange('end', e.target.value)}
            />
          </div>
        </div>

        {/* Export Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-6 border-t border-slate-100">
          {/* Rekap Upah */}
          <div className="p-5 bg-slate-50 rounded-xl flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-800 mb-1 text-sm">Rekap Upah</h3>
              <p className="text-xs text-slate-500 mb-3">Ringkasan kredit hari, lembur, dan total upah per pekerja.</p>
            </div>
            <button
              onClick={handleExportExcel}
              disabled={isDisabled}
              className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
            >
              Ekspor Rekap
            </button>
          </div>

          {/* Absen Harian + Foto */}
          <div className="p-5 bg-blue-50 rounded-xl flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-blue-800 mb-1 text-sm">Absen Harian + Foto</h3>
              <p className="text-xs text-blue-600 mb-3">Detail absensi per hari dengan foto bukti langsung di Excel.</p>
            </div>
            <button
              onClick={handleExportDaily}
              disabled={isDisabled}
              className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
            >
              Ekspor + Foto
            </button>
          </div>

          {/* Backup ZIP */}
          <div className="p-5 bg-slate-50 rounded-xl flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-800 mb-1 text-sm">Arsip Foto (ZIP)</h3>
              <p className="text-xs text-slate-500 mb-3">Semua foto bukti bertanggal beserta manifest JSON.</p>
            </div>
            <button
              onClick={handleBackupZip}
              disabled={isDisabled}
              className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
            >
              Unduh ZIP
            </button>
          </div>

          {/* Purge Storage */}
          <div className="p-5 bg-red-50 rounded-xl flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-red-800 mb-1 text-sm">Purge Foto</h3>
              <p className="text-xs text-red-600 mb-3">Hapus foto dari storage untuk menghemat kuota.</p>
            </div>
            <button
              onClick={previewPurge}
              disabled={isDisabled}
              className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
            >
              Bersihkan
            </button>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <h4 className="text-sm font-semibold text-blue-800 mb-1">Tentang Ekspor Absen Harian + Foto</h4>
          <p className="text-xs text-blue-700">
            Ekspor ini menghasilkan file Excel yang berisi daftar lengkap absensi per hari beserta <strong>foto bukti yang disematkan langsung di setiap baris</strong>.
            Foto ditampilkan sebagai gambar di kolom terakhir sehingga bisa langsung dilihat tanpa membuka file terpisah.
            Format kolom: No, Tanggal & Waktu, Nama Pekerja, NIK, Tipe (Masuk/Pulang), Sumber, Status, Foto Bukti.
          </p>
        </div>
      </div>

      {/* Purge Confirm Overlay */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-red-800 mb-2">Konfirmasi Pembersihan File</h3>
            <p className="text-sm text-slate-500 mb-4">
              Tindakan ini akan menghapus secara permanen <strong className="text-slate-800">{purgeStats.count} foto bukti</strong> untuk periode terpilih.
            </p>

            {!backupVerified && (
              <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-xs rounded-lg border border-amber-200">
                Peringatan: Unduh dan verifikasi ZIP backup terlebih dahulu sebelum menghapus file foto.
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={handlePurge}
                disabled={!backupVerified || loading}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition disabled:opacity-50"
              >
                Ya, Hapus Foto
              </button>
              <button
                onClick={() => setShowPurgeConfirm(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
