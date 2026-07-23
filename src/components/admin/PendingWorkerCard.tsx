'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { CheckCircle, XCircle, Eye } from 'lucide-react'
import { Worker, Project } from '@/types'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/ui/Modal'

interface PendingWorkerCardProps {
  worker: Worker
  onApprove: (worker: Worker) => void
  onReject: (worker: Worker) => void
  onViewKtp: (worker: Worker) => void
}

export default function PendingWorkerCard({ worker, onApprove, onReject, onViewKtp }: PendingWorkerCardProps) {
  const [profileUrl, setProfileUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadPhoto() {
      if (worker.profile_path && worker.profile_path !== 'temp/placeholder_profile.jpg') {
        const { data } = await supabase.storage
          .from('kiosk-photos')
          .createSignedUrl(worker.profile_path, 120)
        if (!cancelled && data) {
          setProfileUrl(data.signedUrl)
        }
      }
    }
    loadPhoto()
    return () => { cancelled = true }
  }, [worker.profile_path])

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5 flex flex-col">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700 shrink-0 border border-slate-200 dark:border-slate-600">
          {profileUrl ? (
            <Image src={profileUrl} alt={worker.name} width={64} height={64} className="w-full h-full object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">No Photo</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{worker.name}</h3>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">{worker.nik}</p>
          <div className="flex gap-2 mt-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {worker.position === 'TK' ? 'Tenaga Kerja' : 'Kepala Regu'}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4 flex-1">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Job Scope</span>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{worker.job_scope || '-'}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Upah Harian</span>
          <p className="text-xs font-mono text-slate-700 dark:text-slate-300">Rp {(worker.daily_wage || 0).toLocaleString('id-ID')}</p>
        </div>
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={() => onViewKtp(worker)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition"
        >
          <Eye className="w-3.5 h-3.5" />
          Tinjau
        </button>
        <button
          onClick={() => onApprove(worker)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Setujui
        </button>
        <button
          onClick={() => onReject(worker)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition"
        >
          <XCircle className="w-3.5 h-3.5" />
          Tolak
        </button>
      </div>
    </div>
  )
}

interface PendingWorkerDetailModalProps {
  worker: Worker | null
  userRole: string | null
  projects: Project[]
  onClose: () => void
  onApprove: (worker: Worker) => void
  onReject: (worker: Worker) => void
}

export function PendingWorkerDetailModal({ worker, userRole, projects, onClose, onApprove, onReject }: PendingWorkerDetailModalProps) {
  const [profileUrl, setProfileUrl] = useState<string | null>(null)
  const [ktpUrl, setKtpUrl] = useState<string | null | 'restricted'>(null)
  const [loading, setLoading] = useState(false)

  const loadPhotos = useCallback(async () => {
    if (!worker) return
    setLoading(true)

    if (worker.profile_path && worker.profile_path !== 'temp/placeholder_profile.jpg') {
      const { data } = await supabase.storage
        .from('kiosk-photos')
        .createSignedUrl(worker.profile_path, 120)
      if (data) setProfileUrl(data.signedUrl)
    }

    if (worker.ktp_private_path) {
      const isPrivate = worker.ktp_private_path.startsWith('private/')
      if (isPrivate) {
        if (userRole !== 'super_admin') {
          setKtpUrl('restricted')
        } else {
          const sessionRes = await supabase.auth.getSession()
          const token = sessionRes.data.session?.access_token
          const res = await fetch('/api/signed-ktp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ workerId: worker.id })
          })
          const data = await res.json()
          if (res.ok && data.signedUrl) {
            setKtpUrl(data.signedUrl)
          } else {
            setKtpUrl(null)
          }
        }
      } else {
        const { data } = await supabase.storage
          .from('kiosk-photos')
          .createSignedUrl(worker.ktp_private_path, 120)
        if (data) setKtpUrl(data.signedUrl)
      }
    }

    setLoading(false)
  }, [worker, userRole])

  useEffect(() => {
    if (worker) {
      const t = setTimeout(() => {
        setProfileUrl(null)
        setKtpUrl(null)
        loadPhotos()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [worker, loadPhotos])

  if (!worker) return null

  const project = projects.find(p => p.id === worker.project_id)

  return (
    <Modal
      isOpen={!!worker}
      onClose={onClose}
      title="Tinjau Pendaftaran Pekerja"
      subtitle="Review data profil, NIK, dan dokumen KTP sebelum menyetujui"
      maxWidth="4xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="space-y-4 md:col-span-1 md:border-r md:border-slate-100 md:dark:border-slate-700 md:pr-4">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Nama Lengkap</label>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{worker.name}</p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">NIK (16 Digit)</label>
            <p className="text-sm font-mono text-slate-800 dark:text-slate-200">{worker.nik}</p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Jabatan</label>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {worker.position === 'TK' ? 'Tenaga Kerja (TK)' : 'Kepala Regu (KN)'}
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Proyek</label>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{project?.name || '-'}</p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Job Scope</label>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{worker.job_scope || '-'}</p>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Upah Harian</label>
            <p className="text-sm font-mono text-slate-800 dark:text-slate-200">Rp {(worker.daily_wage || 0).toLocaleString('id-ID')}</p>
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          {loading ? (
            <div className="py-20 text-center text-slate-400 text-sm">Memuat foto bukti...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col items-center p-3 border border-slate-100 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">Foto Profil Wajah</span>
                {profileUrl ? (
                  <div className="relative w-full aspect-square max-w-[200px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
                    <Image src={profileUrl} alt="Profil" fill className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="w-full aspect-square max-w-[200px] bg-slate-100 dark:bg-slate-600 rounded-lg flex items-center justify-center text-slate-400 text-xs">
                    Tidak ada foto
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center p-3 border border-slate-100 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">Foto KTP Dokumen</span>
                {ktpUrl === 'restricted' ? (
                  <div className="w-full aspect-square max-w-[200px] bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-800 rounded-lg flex flex-col items-center justify-center text-center p-4">
                    <p className="text-xs font-bold text-red-700 dark:text-red-400">Akses Terbatas</p>
                    <p className="text-[10px] text-red-500 dark:text-red-400 mt-1">Hanya Super Admin yang diizinkan melihat KTP privat.</p>
                  </div>
                ) : ktpUrl ? (
                  <div className="relative w-full aspect-square max-w-[200px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
                    <Image src={ktpUrl} alt="KTP" fill className="object-contain" unoptimized />
                  </div>
                ) : (
                  <div className="w-full aspect-square max-w-[200px] bg-slate-100 dark:bg-slate-600 rounded-lg flex items-center justify-center text-slate-400 text-xs">
                    Tidak ada foto
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-700">
        {worker.status === 'pending_approval' && (
          <>
            <button
              onClick={() => onApprove(worker)}
              className="px-6 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Setujui & Aktifkan
            </button>
            <button
              onClick={() => onReject(worker)}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Tolak / Foto Ulang
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="px-6 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold transition"
        >
          Tutup
        </button>
      </div>
    </Modal>
  )
}
