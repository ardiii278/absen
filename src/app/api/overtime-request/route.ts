import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient, verifyAuth, verifyProjectAccess } from '@/lib/server-auth'
import { base64ImageSchema } from '@/lib/validators'

const requestSchema = z.object({
  projectId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
  }, 'Tanggal lembur tidak valid'),
  hours: z.number().finite().min(0.5).max(24).refine((value) => value * 2 === Math.round(value * 2), {
    message: 'Jam lembur harus dalam kelipatan 0,5 jam'
  }),
  workerIds: z.array(z.string().uuid()).min(1).max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Pekerja tidak boleh duplikat'),
  evidenceBase64: z.array(base64ImageSchema).max(5).optional(),
  description: z.string().trim().max(500).optional()
})

export async function POST(req: NextRequest) {
  let auth
  try {
    auth = await verifyAuth(req)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json(
      { error: message === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan' },
      { status: message === 'FORBIDDEN' ? 403 : 401 }
    )
  }

  if (!['kiosk', 'admin', 'super_admin'].includes(auth.profile.role)) {
    return NextResponse.json({ error: 'Role tidak diizinkan mengajukan lembur' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Payload tidak valid' }, { status: 400 })
  }

  const { projectId, workDate, hours, workerIds, evidenceBase64 = [], description } = parsed.data
  const hasAccess = await verifyProjectAccess(auth.client, auth.user.id, auth.profile.role, projectId)
  if (!hasAccess) return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })

  const { data: validWorkers, error: workersError } = await auth.client
    .from('workers').select('id').eq('project_id', projectId).eq('is_active', true).in('id', workerIds)
  if (workersError || validWorkers?.length !== workerIds.length) {
    return NextResponse.json({ error: 'Semua pekerja harus aktif dan terdaftar pada proyek ini' }, { status: 400 })
  }

  let service
  try {
    service = createServiceClient()
  } catch {
    return NextResponse.json({ error: 'Layanan pengajuan lembur belum dikonfigurasi' }, { status: 500 })
  }

  const overtimeId = crypto.randomUUID()
  const evidencePaths: string[] = []
  let overtimeInserted = false
  try {
    for (let index = 0; index < evidenceBase64.length; index++) {
      const image = Buffer.from(evidenceBase64[index].replace(/\s/g, ''), 'base64')
      const path = `overtime/${overtimeId}_${index + 1}.jpg`
      const { error } = await service.storage.from('kiosk-photos').upload(path, image, { contentType: 'image/jpeg', upsert: false })
      if (error) throw new Error(`Gagal mengunggah foto bukti lembur ke-${index + 1}`)
      evidencePaths.push(path)
    }

    const evidenceMetadata = evidencePaths.length || description
      ? JSON.stringify({ paths: evidencePaths, description: description || '' })
      : null

    const { error: overtimeError } = await service.from('overtime').insert({
      id: overtimeId, project_id: projectId, work_date: workDate, hours,
      evidence_path: evidenceMetadata, status: 'pending_approval', created_by: auth.user.id
    })
    if (overtimeError) throw new Error('Gagal menyimpan pengajuan lembur')
    overtimeInserted = true

    const { error: mappingsError } = await service.from('overtime_workers').insert(
      workerIds.map((workerId) => ({ overtime_id: overtimeId, worker_id: workerId, hours }))
    )
    if (mappingsError) throw new Error('Gagal menyimpan daftar pekerja lembur')

    const { error: auditError } = await service.from('audit_logs').insert({
      actor_id: auth.user.id, entity_type: 'overtime', entity_id: overtimeId,
      action: 'CREATED_OVERTIME_REQUEST', reason: `Pengajuan lembur ${hours} jam`,
      new_data: { project_id: projectId, work_date: workDate, hours, workers: workerIds, evidence_paths: evidencePaths, description }
    })
    if (auditError) throw new Error('Gagal menulis audit pengajuan lembur')

    return NextResponse.json({ id: overtimeId }, { status: 201 })
  } catch (error: unknown) {
    if (overtimeInserted) await service.from('overtime').delete().eq('id', overtimeId)
    if (evidencePaths.length) await service.storage.from('kiosk-photos').remove(evidencePaths)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal membuat pengajuan lembur' }, { status: 500 })
  }
}
