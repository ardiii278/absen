import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createAuditLog } from '@/lib/server-auth'
import { signedKtpRequestSchema } from '@/lib/validators'

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user/session
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    const { client, profile } = authContext

    // 2. Verify role is super_admin
    if (profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang diizinkan melihat KTP' }, { status: 403 })
    }

    // 3. Validate request parameter
    const body = await req.json()
    const parsed = signedKtpRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { workerId } = parsed.data

    // 4. Fetch KTP Private path
    const { data: worker, error: workerErr } = await client
      .from('workers')
      .select('ktp_private_path, name')
      .eq('id', workerId)
      .maybeSingle()

    if (workerErr || !worker || !worker.ktp_private_path) {
      return NextResponse.json({ error: 'KTP tidak ditemukan' }, { status: 404 })
    }

    // 5. Generate Signed URL (valid for 60 seconds)
    const { data: signedUrlData, error: signErr } = await client.storage
      .from('kiosk-photos')
      .createSignedUrl(worker.ktp_private_path, 60)

    if (signErr || !signedUrlData) {
      return NextResponse.json({ error: 'Gagal membuat signed URL' }, { status: 500 })
    }

    // 6. Log to Audit Log
    await createAuditLog(
      client,
      authContext.user.id,
      'workers',
      workerId,
      'VIEWED_PRIVATE_KTP',
      `Membuka foto KTP privat pekerja ${worker.name}`
    )

    return NextResponse.json({ signedUrl: signedUrlData.signedUrl })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
