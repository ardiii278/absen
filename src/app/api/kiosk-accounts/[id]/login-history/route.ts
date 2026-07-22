import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createServiceClient } from '@/lib/server-auth'

export async function GET(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    // Only super_admin and admin can view login history
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    // /api/kiosk-accounts/[id]/login-history
    const id = pathParts[pathParts.length - 2]

    if (!id) {
      return NextResponse.json({ error: 'ID akun wajib diisi' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // Verify the kiosk account exists
    const { data: account } = await serviceClient
      .from('kiosk_accounts')
      .select('id, username, project_id')
      .eq('id', id)
      .maybeSingle()

    if (!account) {
      return NextResponse.json({ error: 'Akun kiosk tidak ditemukan' }, { status: 404 })
    }

    // If admin, verify project access
    if (authContext.profile.role === 'admin') {
      const { data: adminProject } = await serviceClient
        .from('admin_projects')
        .select('project_id')
        .eq('user_id', authContext.user.id)
        .eq('project_id', account.project_id)
        .maybeSingle()

      if (!adminProject) {
        return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
      }
    }

    // Fetch login history
    const { data: history, error } = await serviceClient
      .from('kiosk_login_history')
      .select('id, username, ip_address, status, created_at')
      .eq('kiosk_account_id', id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      return NextResponse.json({ error: 'Gagal mengambil histori login' }, { status: 500 })
    }

    return NextResponse.json({ history: history || [] })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
