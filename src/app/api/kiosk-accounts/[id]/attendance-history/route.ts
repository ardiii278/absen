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

    // Only super_admin and admin can view attendance history
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    // /api/kiosk-accounts/[id]/attendance-history
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

    // Get the date range from query params (default: last 30 days)
    const startDate = url.searchParams.get('startDate') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const endDate = url.searchParams.get('endDate') || new Date().toISOString().split('T')[0]

    // Fetch attendance records for this kiosk's project
    const { data: attendance, error } = await serviceClient
      .from('attendance')
      .select('id, worker_id, type, occurred_at, source, status, workers(name, nik)')
      .eq('project_id', account.project_id)
      .gte('occurred_at', `${startDate}T00:00:00Z`)
      .lte('occurred_at', `${endDate}T23:59:59.999Z`)
      .order('occurred_at', { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ error: 'Gagal mengambil histori absensi' }, { status: 500 })
    }

    // Count summary
    const totalRecords = attendance?.length || 0
    const uniqueWorkers = new Set((attendance || []).map((a: { worker_id: string | null }) => a.worker_id).filter(Boolean)).size

    return NextResponse.json({
      attendance: attendance || [],
      summary: {
        totalRecords,
        uniqueWorkers,
        startDate,
        endDate
      }
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
