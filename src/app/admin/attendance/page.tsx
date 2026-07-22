'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface AttendanceRecord {
  id: string
  client_event_id: string
  worker_id: string | null
  project_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  evidence_path: string | null
  status: 'pending_approval' | 'approved' | 'rejected'
  conflict_of: string | null
  late_deduction: number
  workers: {
    name: string
    nik: string
  } | null
}

export default function AttendanceReviewPage() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  // Selection/Correction State
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null)
  const [correctionTime, setCorrectionTime] = useState('')
  const [lateDeduction, setLateDeduction] = useState(0)
  const [reason, setReason] = useState('')

  const fetchAttendance = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, client_event_id, worker_id, project_id, type, occurred_at, evidence_path, status, conflict_of, late_deduction, workers(name, nik)')
        .order('occurred_at', { ascending: false })

      if (error) throw error
      
      const records = (data as unknown as AttendanceRecord[]) || []
      setAttendance(records)
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

      // Log Audit Trail
      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'attendance',
        entity_id: record.id,
        action: `RESOLVED_CONFLICT_${status.toUpperCase()}`,
        reason: 'Resolusi konflik kehadiran oleh admin',
        new_data: { status }
      })
      if (logErr) console.error('Gagal menyimpan audit log:', logErr.message)

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

      // Log Audit Trail
      const userRes = await supabase.auth.getUser()
      const { error: logErr } = await supabase.from('audit_logs').insert({
        actor_id: userRes.data.user?.id || null,
        entity_type: 'attendance',
        entity_id: selectedRecord.id,
        action: 'CORRECTED_ATTENDANCE',
        reason: reason,
        old_data: { occurred_at: selectedRecord.occurred_at, late_deduction: selectedRecord.late_deduction },
        new_data: { occurred_at: updatedOccurredAt, late_deduction: lateDeduction }
      })
      if (logErr) console.error('Gagal menyimpan audit log:', logErr.message)

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
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-800">Review Kehadiran & Resolusi Konflik</h1>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                <th className="py-3 px-4">Nama Pekerja</th>
                <th className="py-3 px-4">Tipe</th>
                <th className="py-3 px-4">Waktu Kejadian</th>
                <th className="py-3 px-4">Denda Keterlambatan</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Konflik Dengan</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Memuat data...</td>
                </tr>
              ) : attendance.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Tidak ada log absensi.</td>
                </tr>
              ) : (
                attendance.map(record => (
                  <tr key={record.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <div className="font-medium">{record.workers?.name}</div>
                      <div className="text-xs text-slate-400">{record.workers?.nik}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        record.type === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {record.type === 'in' ? 'MASUK' : 'PULANG'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {new Date(record.occurred_at).toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 font-mono text-sm">
                      Rp {record.late_deduction.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        record.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                        record.status === 'rejected' ? 'bg-red-50 text-red-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {record.status === 'approved' ? 'Disetujui' :
                        record.status === 'rejected' ? 'Ditolak' : 'Menunggu Approval'}
                      </span>
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
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs transition"
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

        {/* Correction overlay modal */}
        {selectedRecord && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Koreksi Absensi</h3>
              
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-xs text-slate-450 font-semibold mb-1">Pekerja</label>
                  <input
                    type="text"
                    disabled
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-500 text-sm"
                    value={selectedRecord.workers ? `${selectedRecord.workers.name} (${selectedRecord.workers.nik})` : ''}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-450 font-semibold mb-1">Waktu Baru (Kosongkan jika tetap)</label>
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    value={correctionTime}
                    onChange={e => setCorrectionTime(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-450 font-semibold mb-1">Denda Potongan (Rp)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    value={lateDeduction}
                    onChange={e => setLateDeduction(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-450 font-semibold mb-1">Alasan Koreksi (Wajib)</label>
                  <textarea
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-805 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
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
