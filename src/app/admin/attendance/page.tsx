'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AlertTriangle } from 'lucide-react'
import { AttendanceRecord, DuplicateGroup } from '@/types'
import { AttendanceTypeBadge, StatusBadge } from '@/components/ui/StatusBadge'
import DuplicateReconciliationModal, { findDuplicates } from '@/components/admin/DuplicateReconciliationModal'
import Modal from '@/components/ui/Modal'

export default function AttendanceReviewPage() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [selectedDuplicate, setSelectedDuplicate] = useState<DuplicateGroup | null>(null)

  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null)
  const [correctionTime, setCorrectionTime] = useState('')
  const [lateDeduction, setLateDeduction] = useState(0)
  const [reason, setReason] = useState('')

  const fetchAttendance = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, client_event_id, worker_id, project_id, type, occurred_at, evidence_path, status, conflict_of, late_deduction, gps, source, created_by, workers(name, nik)')
        .order('occurred_at', { ascending: false })

      if (error) throw error

      const records = (data as unknown as AttendanceRecord[]) || []
      setAttendance(records)
      setDuplicates(findDuplicates(records))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data absensi'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchAttendance()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchAttendance])

  const handleResolveConflict = async (record: AttendanceRecord, status: 'approved' | 'rejected') => {
    setErrorMsg(null)
    try {
      const { error: updateErr } = await supabase
        .from('attendance')
        .update({ status })
        .eq('id', record.id)

      if (updateErr) throw updateErr

      const userRes = await supabase.auth.getUser()
      await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'attendance',
        entity_id: record.id,
        action: `RESOLVED_CONFLICT_${status.toUpperCase()}`,
        reason: 'Resolusi konflik kehadiran oleh admin',
        new_data: { status }
      })

      await fetchAttendance()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyelesaikan konflik'
      setErrorMsg(msg)
    }
  }

  const handleCorrection = async () => {
    if (!selectedRecord || !reason) return
    setErrorMsg(null)
    try {
      const updatedOccurredAt = correctionTime
        ? new Date(correctionTime).toISOString()
        : selectedRecord.occurred_at

      const { error: updateErr } = await supabase
        .from('attendance')
        .update({
          occurred_at: updatedOccurredAt,
          late_deduction: lateDeduction,
          status: 'approved'
        })
        .eq('id', selectedRecord.id)

      if (updateErr) throw updateErr

      const userRes = await supabase.auth.getUser()
      await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'attendance',
        entity_id: selectedRecord.id,
        action: 'CORRECTED_ATTENDANCE',
        reason: reason,
        old_data: { occurred_at: selectedRecord.occurred_at, late_deduction: selectedRecord.late_deduction },
        new_data: { occurred_at: updatedOccurredAt, late_deduction: lateDeduction }
      })

      setSelectedRecord(null)
      setCorrectionTime('')
      setLateDeduction(0)
      setReason('')
      await fetchAttendance()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan koreksi'
      setErrorMsg(msg)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Approval & Koreksi Absensi</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Review konflik, duplikat, dan koreksi manual absensi</p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-800 flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm rounded-lg border border-emerald-100 dark:border-emerald-800 flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 font-bold">&times;</button>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl shadow-sm border border-amber-200 dark:border-amber-800 p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-lg font-bold text-amber-800 dark:text-amber-300">
              Duplikat Terdeteksi ({duplicates.length})
            </h2>
          </div>

          <div className="space-y-2">
            {duplicates.map((dup) => (
              <div
                key={`${dup.worker_id}-${dup.date}`}
                className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-xl border border-amber-100 dark:border-amber-800/50"
              >
                <div>
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{dup.worker_name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">({dup.worker_nik})</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 ml-3">{dup.date}</span>
                  <span className="text-xs text-slate-400 ml-2">— {dup.records.length} record</span>
                </div>
                <button
                  onClick={() => setSelectedDuplicate(dup)}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition"
                >
                  Rekonsiliasi
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Semua Record Absensi</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 text-sm font-semibold">
                <th className="py-3 px-4">Nama Pekerja</th>
                <th className="py-3 px-4">Tipe</th>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Denda</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Konflik</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">Memuat data...</td></tr>
              ) : attendance.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">Tidak ada log absensi.</td></tr>
              ) : (
                attendance.map(record => (
                  <tr key={record.id} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{record.workers?.name}</div>
                      <div className="text-xs text-slate-400">{record.workers?.nik}</div>
                    </td>
                    <td className="py-3 px-4">
                      <AttendanceTypeBadge type={record.type || 'in'} />
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">
                      {new Date(record.occurred_at).toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 font-mono text-sm text-slate-600 dark:text-slate-400">
                      Rp {record.late_deduction.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={record.status} />
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-400">
                      {record.conflict_of ? record.conflict_of.slice(0, 8) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex gap-2 justify-end">
                        {record.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => handleResolveConflict(record, 'approved')}
                              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs transition"
                            >
                              Setujui
                            </button>
                            <button
                              onClick={() => handleResolveConflict(record, 'rejected')}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition"
                            >
                              Tolak
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setSelectedRecord(record)
                            setLateDeduction(record.late_deduction)
                          }}
                          className="px-2.5 py-1 bg-slate-800 dark:bg-slate-600 hover:bg-slate-900 dark:hover:bg-slate-500 text-white rounded text-xs transition"
                        >
                          Koreksi
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DuplicateReconciliationModal
        duplicate={selectedDuplicate}
        onClose={() => setSelectedDuplicate(null)}
        onResolved={async () => {
          setSuccessMsg('Duplikat berhasil diselesaikan.')
          await fetchAttendance()
        }}
      />

      <Modal
        isOpen={!!selectedRecord}
        onClose={() => {
          setSelectedRecord(null)
          setCorrectionTime('')
          setLateDeduction(0)
          setReason('')
        }}
        title="Koreksi Absensi"
        subtitle="Perubahan akan dicatat di audit log"
      >
        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">Pekerja</label>
            <input
              type="text"
              disabled
              className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-500 dark:text-slate-400 text-sm"
              value={selectedRecord?.workers ? `${selectedRecord.workers.name} (${selectedRecord.workers.nik})` : ''}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">Waktu Baru (Kosongkan jika tetap)</label>
            <input
              type="datetime-local"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 text-sm focus:outline-none"
              value={correctionTime}
              onChange={e => setCorrectionTime(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">Denda Potongan (Rp)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 text-sm focus:outline-none"
              value={lateDeduction}
              onChange={e => setLateDeduction(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">Alasan Koreksi (Wajib)</label>
            <textarea
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Salah scan / revisi lembur..."
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={handleCorrection}
            disabled={!reason}
            className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50"
          >
            Simpan Koreksi
          </button>
          <button
            onClick={() => {
              setSelectedRecord(null)
              setCorrectionTime('')
              setLateDeduction(0)
              setReason('')
            }}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition"
          >
            Batal
          </button>
        </div>
      </Modal>
    </div>
  )
}
