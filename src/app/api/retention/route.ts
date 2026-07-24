import { NextRequest, NextResponse } from 'next/server'
import { createAuditLog, createServiceClient, getProjectDateRangeBoundaries, getProjectTimezoneOffset, verifyAuth, verifyProjectAccess } from '@/lib/server-auth'
import { exportRequestSchema } from '@/lib/validators'

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuth(req)
    if (!['admin', 'super_admin'].includes(auth.profile.role)) {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = exportRequestSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const { projectId, startDate, endDate } = parsed.data
    const jobScope = typeof body.jobScope === 'string' && body.jobScope ? body.jobScope : null
    const action = body.action === 'purge' ? 'purge' : 'preview'

    const hasAccess = await verifyProjectAccess(auth.client, auth.user.id, auth.profile.role, projectId)
    if (!hasAccess) return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })

    const service = createServiceClient()
    const offsetHours = await getProjectTimezoneOffset(service, projectId)
    const { startUtcStr, endUtcStr } = getProjectDateRangeBoundaries(startDate, endDate, offsetHours)

    let workerIds: string[] | null = null
    if (jobScope) {
      const { data: workers, error } = await service
        .from('workers')
        .select('id')
        .eq('project_id', projectId)
        .eq('job_scope', jobScope)
      if (error) throw new Error(`Gagal mengambil pekerja: ${error.message}`)
      const matchingWorkerIds = (workers || []).map((worker: { id: string }) => worker.id)
      if (!matchingWorkerIds.length) return NextResponse.json({ count: 0 })
      workerIds = matchingWorkerIds
    }

    let query = service
      .from('attendance')
      .select('id, evidence_path')
      .eq('project_id', projectId)
      .gte('occurred_at', startUtcStr)
      .lte('occurred_at', endUtcStr)
      .not('evidence_path', 'is', null)
    if (workerIds) query = query.in('worker_id', workerIds)

    const { data, error } = await query
    if (error) throw new Error(`Gagal mengambil bukti absensi: ${error.message}`)
    const records = (data || []) as { id: string; evidence_path: string | null }[]
    if (action === 'preview') return NextResponse.json({ count: records.length })
    if (!body.backupConfirmed) {
      return NextResponse.json({ error: 'Backup untuk pilihan data ini belum dikonfirmasi' }, { status: 400 })
    }

    const paths = records.map(record => record.evidence_path).filter((path): path is string => !!path)
    if (paths.length) {
      const { error: removeError } = await service.storage.from('kiosk-photos').remove(paths)
      if (removeError) throw new Error(`Gagal menghapus foto: ${removeError.message}`)
      const { error: updateError } = await service
        .from('attendance')
        .update({ evidence_path: null })
        .in('id', records.map(record => record.id))
      if (updateError) throw new Error(`Foto terhapus tetapi referensi data gagal diperbarui: ${updateError.message}`)
    }

    await createAuditLog(
      service,
      auth.user.id,
      'projects',
      projectId,
      'PURGED_STORAGE_EVIDENCE',
      `Pembersihan ${records.length} foto periode ${startDate} - ${endDate}${jobScope ? ` job scope ${jobScope}` : ''}`
    )
    return NextResponse.json({ success: true, count: records.length })
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Operasi retensi gagal' }, { status: 500 })
  }
}
