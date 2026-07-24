import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, verifyAuth } from '@/lib/server-auth'

const BUCKET = 'kiosk-photos'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function decodeImage(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || !value) throw new Error(`${label} wajib diisi`)
  const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  const image = Buffer.from(base64, 'base64')
  if (!image.length || image.length > MAX_IMAGE_BYTES) {
    throw new Error(`${label} tidak valid atau melebihi 5 MB`)
  }
  return image
}

export async function POST(req: NextRequest) {
  let profilePath: string | null = null
  let ktpPath: string | null = null

  try {
    const auth = await verifyAuth(req)
    if (auth.profile.role !== 'kiosk') {
      return NextResponse.json({ error: 'Hanya akun kiosk yang dapat mendaftarkan pekerja' }, { status: 403 })
    }

    const body = await req.json()
    const { nik, name, position, jobScope, projectId, faceDescriptor, profileImage, ktpImage } = body
    if (!/^[0-9]{16}$/.test(String(nik || ''))) {
      return NextResponse.json({ error: 'NIK harus tepat 16 digit angka' }, { status: 400 })
    }
    if (typeof name !== 'string' || !name.trim() || typeof jobScope !== 'string' || !jobScope.trim()) {
      return NextResponse.json({ error: 'Nama dan job scope wajib diisi' }, { status: 400 })
    }
    if (!['TK', 'KN'].includes(position) || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
      return NextResponse.json({ error: 'Data jabatan atau wajah tidak valid' }, { status: 400 })
    }

    const service = createServiceClient()
    const { data: kiosk } = await service
      .from('kiosk_accounts')
      .select('project_id, is_active')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle()
    if (!kiosk?.is_active || kiosk.project_id !== projectId) {
      return NextResponse.json({ error: 'Akun kiosk tidak memiliki akses ke proyek ini' }, { status: 403 })
    }

    const { data: existing } = await service.from('workers').select('id').eq('nik', nik).maybeSingle()
    if (existing) return NextResponse.json({ error: 'NIK sudah terdaftar' }, { status: 409 })

    const profile = decodeImage(profileImage, 'Foto profil')
    const ktp = decodeImage(ktpImage, 'Foto KTP')
    const unique = `${nik}_${Date.now()}_${crypto.randomUUID()}`
    profilePath = `temp/profile_${unique}.jpg`
    ktpPath = `temp/ktp_${unique}.jpg`

    const profileUpload = await service.storage.from(BUCKET).upload(profilePath, profile, {
      contentType: 'image/jpeg',
      upsert: false
    })
    if (profileUpload.error) throw new Error(`Upload foto profil gagal: ${profileUpload.error.message}`)

    const ktpUpload = await service.storage.from(BUCKET).upload(ktpPath, ktp, {
      contentType: 'image/jpeg',
      upsert: false
    })
    if (ktpUpload.error) throw new Error(`Upload foto KTP gagal: ${ktpUpload.error.message}`)

    const { error: insertError } = await service.from('workers').insert({
      nik,
      name: name.trim(),
      position,
      job_scope: jobScope.trim(),
      project_id: projectId,
      profile_path: profilePath,
      ktp_private_path: ktpPath,
      face_descriptor: faceDescriptor,
      status: 'pending_approval',
      is_active: false,
      daily_wage: position === 'TK' ? 150000 : 250000
    })
    if (insertError) throw new Error(`Penyimpanan pekerja gagal: ${insertError.message}`)

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal mendaftarkan pekerja'
    try {
      const service = createServiceClient()
      const paths = [profilePath, ktpPath].filter((path): path is string => !!path)
      if (paths.length) await service.storage.from(BUCKET).remove(paths)
    } catch {
      // Keep the original registration error.
    }
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
