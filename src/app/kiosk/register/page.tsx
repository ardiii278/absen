'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { supabase } from '@/lib/supabase'

const registerSchema = z.object({
  nik: z.string().regex(/^[0-9]{16}$/, 'NIK harus tepat 16 digit angka'),
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  position: z.enum(['TK', 'KN']),
  job_scope: z.string().min(3, 'Job scope minimal 3 karakter'),
})

type RegisterFormValues = z.infer<typeof registerSchema>

// Pure function helper defined outside the component to avoid react-hooks/purity errors
function generateFileName(nik: string, prefix: string): string {
  return `${prefix}_${nik}_${Date.now()}.jpg`
}

export default function KioskRegisterPage() {
  const router = useRouter()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Camera state
  const [cameraActive, setCameraActive] = useState(false)
  const [photoType, setPhotoType] = useState<'profile' | 'ktp' | null>(null)
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [ktpPhoto, setKtpPhoto] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  })

  useEffect(() => {
    const pId = localStorage.getItem('kiosk_project_id')
    if (!pId) {
      router.push('/login')
    } else {
      // Run asynchronously to avoid react-hooks/set-state-in-effect
      setTimeout(() => {
        setProjectId(pId)
      }, 0)
    }
  }, [router])

  // Camera cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const startCamera = async (type: 'profile' | 'ktp') => {
    setPhotoType(type)
    setCameraActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch {
      setErrorMsg('Gagal mengakses kamera. Pastikan izin kamera diberikan.')
      setCameraActive(false)
    }
  }

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, 640, 480)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        if (photoType === 'profile') setProfilePhoto(dataUrl)
        if (photoType === 'ktp') setKtpPhoto(dataUrl)
      }
      stopCamera()
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    setPhotoType(null)
  }

  // Convert Base64 DataURL to Blob for Upload
  const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',')
    const match = arr[0].match(/:(.*?);/)
    const mime = match ? match[1] : 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  const onSubmit = async (values: RegisterFormValues) => {
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!profilePhoto || !ktpPhoto) {
      setErrorMsg('Foto Profil dan Foto KTP wajib diambil dari kamera.')
      return
    }

    if (!projectId) {
      setErrorMsg('Project ID tidak ditemukan. Harap login kembali.')
      return
    }

    setLoading(true)
    try {
      // 1. Check unique NIK
      const { data: existingWorker, error: checkErr } = await supabase
        .from('workers')
        .select('id')
        .eq('nik', values.nik)
        .maybeSingle()

      if (checkErr) throw new Error('Gagal memeriksa data NIK.')
      if (existingWorker) {
        throw new Error('Pekerja dengan NIK ini sudah terdaftar.')
      }

      // 2. Upload photos to Supabase Storage
      const profileBlob = dataURLtoBlob(profilePhoto)
      const ktpBlob = dataURLtoBlob(ktpPhoto)

      const profileFileName = generateFileName(values.nik, 'profile')
      const ktpFileName = generateFileName(values.nik, 'ktp')

      // Upload profile
      const { data: profileUpload, error: profileErr } = await supabase.storage
        .from('kiosk-photos')
        .upload(`temp/${profileFileName}`, profileBlob, { contentType: 'image/jpeg' })

      if (profileErr || !profileUpload) throw new Error(`Gagal mengunggah foto profil: ${profileErr?.message || 'Error'}`)

      // Upload KTP
      const { data: ktpUpload, error: ktpErr } = await supabase.storage
        .from('kiosk-photos')
        .upload(`temp/${ktpFileName}`, ktpBlob, { contentType: 'image/jpeg' })

      if (ktpErr || !ktpUpload) {
        // Rollback uploaded profile photo
        await supabase.storage.from('kiosk-photos').remove([`temp/${profileFileName}`])
        throw new Error(`Gagal mengunggah foto KTP: ${ktpErr?.message || 'Error'}`)
      }

      // 3. Insert Worker (status pending_approval, is_active false)
      const { error: insertErr } = await supabase.from('workers').insert({
        nik: values.nik,
        name: values.name,
        position: values.position,
        job_scope: values.job_scope,
        project_id: projectId,
        profile_path: profileUpload.path,
        ktp_private_path: ktpUpload.path, // Temporary path in temp/, will move during approval
        status: 'pending_approval',
        is_active: false,
        daily_wage: values.position === 'TK' ? 150000 : 250000
      })

      if (insertErr) {
        // Rollback both photos
        await supabase.storage.from('kiosk-photos').remove([`temp/${profileFileName}`, `temp/${ktpFileName}`])
        throw insertErr
      }

      setSuccessMsg('Registrasi berhasil! Menunggu verifikasi dari Admin.')
      setTimeout(() => {
        router.push('/kiosk')
      }, 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan data.'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-6 text-center">Registrasi Pekerja Baru</h1>

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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">NIK (16 Digit)</label>
              <input
                type="text"
                placeholder="1234567890123456"
                className={`w-full px-3 py-2 border rounded-lg text-sm text-slate-850 focus:outline-none ${errors.nik ? 'border-red-500' : 'border-slate-200'}`}
                {...register('nik')}
              />
              {errors.nik && <p className="text-red-500 text-xs mt-1">{errors.nik.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nama Lengkap</label>
              <input
                type="text"
                placeholder="Nama sesuai KTP"
                className={`w-full px-3 py-2 border rounded-lg text-sm text-slate-850 focus:outline-none ${errors.name ? 'border-red-500' : 'border-slate-200'}`}
                {...register('name')}
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Jabatan</label>
              <select
                className={`w-full px-3 py-2 border rounded-lg text-sm text-slate-850 focus:outline-none ${errors.position ? 'border-red-500' : 'border-slate-200'}`}
                {...register('position')}
              >
                <option value="TK">Tenaga Kerja (TK)</option>
                <option value="KN">Kepala Regu (KN)</option>
              </select>
              {errors.position && <p className="text-red-500 text-xs mt-1">{errors.position.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Job Scope</label>
              <input
                type="text"
                placeholder="misal: Plaster, Galian, Struktur"
                className={`w-full px-3 py-2 border rounded-lg text-sm text-slate-850 focus:outline-none ${errors.job_scope ? 'border-red-500' : 'border-slate-200'}`}
                {...register('job_scope')}
              />
              {errors.job_scope && <p className="text-red-500 text-xs mt-1">{errors.job_scope.message}</p>}
            </div>
          </div>

          {/* Camera Capture Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
            <div className="flex flex-col items-center p-4 border border-dashed border-slate-200 rounded-xl">
              <span className="text-sm font-semibold text-slate-700 mb-3">Foto Profil Wajah</span>
              {profilePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profilePhoto} alt="Profil" className="w-32 h-32 object-cover rounded-full border border-slate-150 mb-3" />
              ) : (
                <div className="w-32 h-32 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 text-xs mb-3">
                  Belum ada foto
                </div>
              )}
              <button
                type="button"
                onClick={() => startCamera('profile')}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
              >
                Ambil Foto
              </button>
            </div>

            <div className="flex flex-col items-center p-4 border border-dashed border-slate-200 rounded-xl">
              <span className="text-sm font-semibold text-slate-700 mb-3">Foto KTP</span>
              {ktpPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ktpPhoto} alt="KTP" className="w-48 h-32 object-cover rounded-lg border border-slate-150 mb-3" />
              ) : (
                <div className="w-48 h-32 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs mb-3">
                  Belum ada foto
                </div>
              )}
              <button
                type="button"
                onClick={() => startCamera('ktp')}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
              >
                Ambil Foto
              </button>
            </div>
          </div>

          {/* Camera View Modal */}
          {cameraActive && (
            <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl p-6 max-w-lg w-full flex flex-col items-center">
                <h3 className="text-lg font-bold text-slate-800 mb-4 capitalize">
                  Ambil Foto {photoType === 'profile' ? 'Profil Wajah' : 'KTP'}
                </h3>
                <div className="aspect-video w-full bg-black rounded-xl overflow-hidden mb-6">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                </div>
                <div className="flex gap-4 w-full">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition"
                  >
                    Tangkap Gambar
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-4 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => router.push('/kiosk')}
              className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition"
            >
              Kembali
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition disabled:opacity-50"
            >
              {loading ? 'Menyimpan...' : 'Kirim Registrasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
