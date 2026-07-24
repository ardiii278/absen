import { NextRequest, NextResponse } from 'next/server'
import { createAuditLog, createServiceClient, verifyAuth, verifyProjectAccess } from '@/lib/server-auth'

interface ReconciliationRecord {
  id: string
  worker_id: string | null
  project_id: string | null
  type: string | null
  occurred_at: string
  status: string
  conflict_of: string | null
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuth(req)
    if (!['admin', 'super_admin'].includes(auth.profile.role)) {
      return NextResponse.json({ error: 'Hanya admin yang dapat merekonsiliasi absensi' }, { status: 403 })
    }

    const body = await req.json()
    const recordIds: string[] = Array.isArray(body.recordIds)
      ? body.recordIds.filter((id: unknown): id is string => typeof id === 'string')
      : []
    const selectedValidId = typeof body.selectedValidId === 'string' ? body.selectedValidId : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (recordIds.length < 2 || !selectedValidId || !recordIds.includes(selectedValidId) || !reason) {
      return NextResponse.json({ error: 'Pilihan record dan alasan rekonsiliasi wajib diisi' }, { status: 400 })
    }

    const service = createServiceClient()
    const { data, error } = await service
      .from('attendance')
      .select('id, worker_id, project_id, type, occurred_at, status, conflict_of')
      .in('id', recordIds)
    if (error) throw new Error(`Gagal mengambil record: ${error.message}`)
    if (!data || data.length !== recordIds.length) {
      return NextResponse.json({ error: 'Sebagian record absensi tidak ditemukan' }, { status: 404 })
    }

    const records = data as ReconciliationRecord[]
    const first = records[0]
    const sameGroup = records.every((record: ReconciliationRecord) =>
      record.worker_id === first.worker_id &&
      record.project_id === first.project_id &&
      record.type === first.type &&
      new Date(record.occurred_at).toISOString().slice(0, 10) === new Date(first.occurred_at).toISOString().slice(0, 10)
    )
    if (!first.project_id || !sameGroup) {
      return NextResponse.json({ error: 'Record bukan berasal dari grup duplikat yang sama' }, { status: 400 })
    }

    const hasAccess = await verifyProjectAccess(auth.client, auth.user.id, auth.profile.role, first.project_id)
    if (!hasAccess) return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })

    const rejectedIds = recordIds.filter((id: string) => id !== selectedValidId)
    const { data: approved, error: approveError } = await service
      .from('attendance')
      .update({ status: 'approved', conflict_of: null })
      .eq('id', selectedValidId)
      .select('id')
    if (approveError || approved?.length !== 1) {
      throw new Error(`Record pilihan gagal disetujui: ${approveError?.message || 'record tidak berubah'}`)
    }

    const { data: rejected, error: rejectError } = await service
      .from('attendance')
      .update({ status: 'rejected' })
      .in('id', rejectedIds)
      .select('id')
    if (rejectError || rejected?.length !== rejectedIds.length) {
      throw new Error(`Record duplikat gagal ditolak: ${rejectError?.message || 'jumlah record tidak sesuai'}`)
    }

    await Promise.all(records.map((record: ReconciliationRecord) => createAuditLog(
      service,
      auth.user.id,
      'attendance',
      record.id,
      record.id === selectedValidId ? 'RESOLVED_DUPLICATE_VALID' : 'RESOLVED_DUPLICATE_INVALID',
      reason,
      { status: record.status, conflict_of: record.conflict_of },
      { status: record.id === selectedValidId ? 'approved' : 'rejected', conflict_of: record.id === selectedValidId ? null : record.conflict_of }
    )))

    return NextResponse.json({ success: true, approvedId: selectedValidId, rejectedCount: rejectedIds.length })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal menyelesaikan duplikat'
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'FORBIDDEN' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
