'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Camera, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { extractDescriptorFromBlob } from '@/lib/face/api'
import Modal from '@/components/ui/Modal'

interface RegisterWorkerModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
}

export default function RegisterWorkerModal({ isOpen, onClose, projectId }: RegisterWorkerModalProps) {
  const [nik, setNik] = useState('')
  const [name, setName] = useState('')
  const [position, setPosition] = useState<'TK' | 'KN'>('TK')
  const [jobScope, setJobScope] = useState('')
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [ktpPhoto, setKtpPhoto] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [photoType, setPhotoType] = useState<'profile' | 'ktp' | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    setPhotoType(null)
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  const closeModal = () => {
    setNik('')
    setName('')
    setJobScope('')
    setProfilePhoto(null)
    setKtpPhoto(null)
    setErrorMsg(null)
    setSuccessMsg(null)
    stopCamera()
    onClose()
  }

  const startCamera = async (type: 'profile' | 'ktp') => {
    setPhotoType(type)
    setCameraActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setErrorMsg('Gagal mengakses kamera.')
      setCameraActive(false)
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = 640; canvas.height = 480
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, 640, 480)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      if (photoType === 'profile') setProfilePhoto(dataUrl)
      if (photoType === 'ktp') setKtpPhoto(dataUrl)
    }
    stopCamera()
  }

  const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',')
    const match = arr[0].match(/:(.*?);/)
    const mime = match ? match[1] : 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new Blob([u8arr], { type: mime })
  }

  const handleSubmit = async () => {
    setErrorMsg(null); setSuccessMsg(null)

    if (!nik || !name || !jobScope) {
      setErrorMsg('Semua field wajib diisi.'); return
    }
    if (!/^[0-9]{16}$/.test(nik)) {
      setErrorMsg('NIK harus tepat 16 digit angka.'); return
    }
    if (!profilePhoto || !ktpPhoto) {
      setErrorMsg('Foto Profil dan Foto KTP wajib diambil.'); return
    }

    setLoading(true)
    try {
      const { data: existing } = await supabase.from('workers').select('id').eq('nik', nik).maybeSingle()
      if (existing) throw new Error('NIK sudah terdaftar.')

      const profileBlob = dataURLtoBlob(profilePhoto)
      const ktpBlob = dataURLtoBlob(ktpPhoto)
      const faceDescriptor = await extractDescriptorFromBlob(profileBlob)
      const ts = Date.now()

      const { data: profUpload, error: profErr } = await supabase.storage
        .from('kiosk-photos').upload(`temp/profile_${nik}_${ts}.jpg`, profileBlob, { contentType: 'image/jpeg' })
      if (profErr || !profUpload) throw new Error('Gagal upload foto profil.')

      const { data: ktpUpload, error: ktpErr } = await supabase.storage
        .from('kiosk-photos').upload(`temp/ktp_${nik}_${ts}.jpg`, ktpBlob, { contentType: 'image/jpeg' })
      if (ktpErr || !ktpUpload) {
        await supabase.storage.from('kiosk-photos').remove([profUpload.path])
        throw new Error('Gagal upload foto KTP.')
      }

      const { error: insertErr } = await supabase.from('workers').insert({
        nik, name, position,
        job_scope: jobScope,
        project_id: projectId,
        profile_path: profUpload.path,
        ktp_private_path: ktpUpload.path,
        face_descriptor: faceDescriptor,
        status: 'pending_approval',
        is_active: false,
        daily_wage: position === 'TK' ? 150000 : 250000
      })
      if (insertErr) {
        await supabase.storage.from('kiosk-photos').remove([profUpload.path, ktpUpload.path])
        throw insertErr
      }

      setSuccessMsg('Registrasi berhasil! Menunggu verifikasi Admin.')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan data.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Modal
        isOpen={isOpen && !cameraActive}
        onClose={closeModal}
        title="Registrasi Pekerja Baru"
        subtitle="Data akan disimpan dengan status pending approval"
        maxWidth="lg"
      >
        {errorMsg && <div className="mb-4 p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100">{errorMsg}</div>}
        {successMsg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-100 flex items-center gap-2"><CheckCircle className="w-4 h-4" />{successMsg}</div>}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">NIK (16 Digit)</label>
            <input type="text" maxLength={16} placeholder="1234567890123456"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none"
              value={nik} onChange={e => setNik(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
            <input type="text" placeholder="Nama sesuai KTP"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Jabatan</label>
            <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
              value={position} onChange={e => setPosition(e.target.value as 'TK' | 'KN')}>
              <option value="TK">Tenaga Kerja (TK)</option>
              <option value="KN">Kepala Regu (KN)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Job Scope</label>
            <input type="text" placeholder="misal: HARDSCAPE"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none"
              value={jobScope} onChange={e => setJobScope(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {(['profile', 'ktp'] as const).map(type => (
            <div key={type} className="flex flex-col items-center p-3 border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs font-semibold text-slate-700 mb-2">
                {type === 'profile' ? 'Foto Profil Wajah' : 'Foto KTP'}
              </span>
              {(type === 'profile' ? profilePhoto : ktpPhoto) ? (
                <div className="w-20 h-20 bg-emerald-50 rounded-lg flex items-center justify-center mb-2">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              ) : (
                <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center mb-2">
                  <Camera className="w-6 h-6 text-slate-400" />
                </div>
              )}
              <button type="button" onClick={() => startCamera(type)}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition">
                Ambil Foto
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-100">
          <button onClick={handleSubmit} disabled={loading || !!successMsg}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition disabled:opacity-50">
            {loading ? 'Menyimpan...' : 'Kirim Registrasi'}
          </button>
          <button onClick={closeModal}
            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition">
            Batal
          </button>
        </div>
      </Modal>

      {/* Camera Modal */}
      {cameraActive && (
        <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col items-center">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              Ambil Foto {photoType === 'profile' ? 'Profil Wajah' : 'KTP'}
            </h3>
            <div className="aspect-video w-full bg-black rounded-xl overflow-hidden mb-4">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-4 w-full">
              <button onClick={capturePhoto}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition">
                Tangkap
              </button>
              <button onClick={stopCamera}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition">
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
