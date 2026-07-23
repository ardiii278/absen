import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient, verifyAuth, verifyProjectAccess } from '@/lib/server-auth'

const BUCKET = 'kiosk-photos'
const CONFIG_PATH = 'config/job_scopes.json'

const updateSchema = z.object({
  projectId: z.string().uuid(),
  scopes: z.array(z.string().trim().min(2).max(160)).max(200)
})

async function loadConfig(service: ReturnType<typeof createServiceClient>): Promise<Record<string, string[]>> {
  const { data, error } = await service.storage.from(BUCKET).download(CONFIG_PATH)
  if (error || !data) return {}
  try {
    const parsed = JSON.parse(await data.text())
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : {}
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAuth(req)
    if (!['admin', 'super_admin'].includes(auth.profile.role)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 })
    }
    const service = createServiceClient()
    return NextResponse.json({ scopes: await loadConfig(service) })
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid' }, { status: 401 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await verifyAuth(req)
    if (!['admin', 'super_admin'].includes(auth.profile.role)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 })
    }
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Data tidak valid' }, { status: 400 })
    }
    const { projectId, scopes } = parsed.data
    if (!await verifyProjectAccess(auth.client, auth.user.id, auth.profile.role, projectId)) {
      return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
    }

    const service = createServiceClient()
    const config = await loadConfig(service)
    const normalized = Array.from(new Set(scopes.map(scope => scope.trim().toUpperCase()))).sort()
    config[projectId] = normalized
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const { error } = await service.storage.from(BUCKET).upload(CONFIG_PATH, blob, {
      contentType: 'application/json',
      upsert: true
    })
    if (error) throw error

    await service.from('audit_logs').insert({
      actor_id: auth.user.id,
      entity_type: 'projects',
      entity_id: projectId,
      action: 'UPDATED_JOB_SCOPES',
      reason: 'Daftar sub pekerjaan proyek diperbarui',
      new_data: { scopes: normalized }
    })
    return NextResponse.json({ scopes: normalized })
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal menyimpan sub pekerjaan' }, { status: 500 })
  }
}
