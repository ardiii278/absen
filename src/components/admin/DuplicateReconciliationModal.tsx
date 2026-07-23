'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { AlertTriangle, CheckCircle, MapPin, Clock } from 'lucide-react'
import { AttendanceRecord, DuplicateGroup } from '@/types'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/ui/Modal'
import { AttendanceTypeBadge, SourceBadge } from '@/components/ui/StatusBadge'

interface DuplicateReconciliationModalProps {
  duplicate: DuplicateGroup | null
  onClose: () => void
  onResolved: () => void
}

export default function DuplicateReconciliationModal({ duplicate, onClose, onResolved }: DuplicateReconciliationModalProps) {
  const [selectedValidId, setSelectedValidId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string | null>>({})

  const loadEvidencePhotos = useCallback(async () => {
    if (!duplicate) return
    const urls: Record<string, string | null> = {}
    for (const record of duplicate.records) {
      if (record.evidence_path) {
        const { data } = await supabase.storage
          .from('kiosk-photos')
          .createSignedUrl(record.evidence_path, 120)
        urls[record.id] = data?.signedUrl || null
      } else {
        urls[record.id] = null
      }
    }
    setEvidenceUrls(urls)
  }, [duplicate])

  useEffect(() => {
    if (duplicate) {
      const t = setTimeout(() => {
        setSelectedValidId(null)
        setReason('')
        setErrorMsg(null)
        setEvidenceUrls({})
        loadEvidencePhotos()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [duplicate, loadEvidencePhotos])

  const handleResolve = async () => {
    if (!duplicate || !selectedValidId || !reason) return
    setLoading(true)
    setErrorMsg(null)

    try {
      const userRes = await supabase.auth.getUser()
      const actorId = userRes.data.user?.id || null

      for (const record of duplicate.records) {
        if (record.id === selectedValidId) {
          const { error } = await supabase
            .from('attendance')
            .update({ status: 'approved', conflict_of: null })
            .eq('id', record.id)
          if (error) throw error

          await supabase.from('audit_logs').insert({
            actor_id: actorId,
            entity_type: 'attendance',
            entity_id: record.id,
            action: 'RESOLVED_DUPLICATE_VALID',
            reason: reason,
            old_data: { status: record.status, conflict_of: record.conflict_of },
            new_data: { status: 'approved', conflict_of: null }
          })
        } else {
          const { error } = await supabase
            .from('attendance')
            .update({ status: 'rejected' })
            .eq('id', record.id)
          if (error) throw error

          await supabase.from('audit_logs').insert({
            actor_id: actorId,
            entity_type: 'attendance',
            entity_id: record.id,
            action: 'RESOLVED_DUPLICATE_INVALID',
            reason: reason,
            old_data: { status: record.status },
            new_data: { status: 'rejected' }
          })
        }
      }

      onResolved()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyelesaikan duplikat'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  if (!duplicate) return null

  return (
    <Modal
      isOpen={!!duplicate}
      onClose={onClose}
      title="Rekonsiliasi Absensi Duplikat"
      subtitle={`${duplicate.worker_name} (${duplicate.worker_nik}) — ${duplicate.date}`}
      maxWidth="4xl"
    >
      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded-lg border border-red-100 dark:border-red-800">
          {errorMsg}
        </div>
      )}

      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Ditemukan <strong>{duplicate.records.length} record</strong> absensi pada tanggal yang sama. Pilih record yang valid, lainnya akan ditolak otomatis.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {duplicate.records.map((record, idx) => {
          const isSelected = selectedValidId === record.id
          const evidenceUrl = evidenceUrls[record.id]
          const time = new Date(record.occurred_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

          return (
            <div
              key={record.id}
              onClick={() => setSelectedValidId(record.id)}
              className={`relative p-4 rounded-xl border-2 cursor-pointer transition ${
                isSelected
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20 shadow-md'
                  : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              )}

              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Option {String.fromCharCode(65 + idx)}</span>
                <AttendanceTypeBadge type={record.type || 'in'} />
                <SourceBadge source={record.source} />
              </div>

              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{time}</span>
              </div>

              {record.gps && (
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {(record.gps as { latitude: number; longitude: number }).latitude.toFixed(6)}, {(record.gps as { latitude: number; longitude: number }).longitude.toFixed(6)}
                  </span>
                </div>
              )}

              <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mb-3">
                ID: {record.client_event_id}
              </div>

              {evidenceUrl ? (
                <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700">
                  <Image src={evidenceUrl} alt={`Bukti Option ${String.fromCharCode(65 + idx)}`} fill className="object-contain" unoptimized />
                </div>
              ) : (
                <div className="w-full aspect-video rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 text-xs">
                  Tidak ada foto bukti
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Alasan Koreksi (Wajib)</label>
        <textarea
          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Jelaskan mengapa record ini dipilih sebagai yang valid..."
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>

      <div className="flex gap-3 justify-end pt-4 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={handleResolve}
          disabled={!selectedValidId || !reason || loading}
          className="px-6 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4" />
          {loading ? 'Menyimpan...' : 'Simpan Rekonsiliasi'}
        </button>
        <button
          onClick={onClose}
          className="px-6 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold transition"
        >
          Batal
        </button>
      </div>
    </Modal>
  )
}

export function findDuplicates(records: AttendanceRecord[]): DuplicateGroup[] {
  const groups = new Map<string, AttendanceRecord[]>()

  for (const record of records) {
    if (!record.worker_id || !record.occurred_at) continue
    const dateStr = new Date(record.occurred_at).toISOString().split('T')[0]
    const key = `${record.worker_id}_${dateStr}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(record)
  }

  const duplicates: DuplicateGroup[] = []
  for (const [, recs] of groups) {
    if (recs.length >= 2) {
      const first = recs[0]
      const dateStr = new Date(first.occurred_at).toISOString().split('T')[0]
      duplicates.push({
        worker_id: first.worker_id || '',
        worker_name: first.workers?.name || 'Unknown',
        worker_nik: first.workers?.nik || 'Unknown',
        date: dateStr,
        records: recs
      })
    }
  }

  return duplicates
}
