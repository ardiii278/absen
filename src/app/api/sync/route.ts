import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, getProjectLocalDayBoundaries } from '@/lib/server-auth'
import { syncRequestSchema } from '@/lib/validators'

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

    const { client } = authContext

    // 2. Validate request body
    const body = await req.json()
    const parsed = syncRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { events } = parsed.data
    const results = []

    for (const event of events) {
      const { client_event_id, payload, evidenceBase64 } = event

      try {
        // A. Verify project access
        const hasAccess = await verifyProjectAccess(client, authContext.user.id, authContext.profile.role, payload.project_id)
        if (!hasAccess) {
          results.push({ client_event_id, status: 'failed', error: 'Akses proyek ditolak' })
          continue
        }

        // B. Verify worker belongs to project and is active
        const { data: worker, error: workerErr } = await client
          .from('workers')
          .select('id, is_active')
          .eq('id', payload.worker_id)
          .eq('project_id', payload.project_id)
          .maybeSingle()

        if (workerErr || !worker) {
          results.push({ client_event_id, status: 'failed', error: 'Pekerja tidak valid untuk proyek ini' })
          continue
        }

        if (!worker.is_active) {
          results.push({ client_event_id, status: 'failed', error: 'Pekerja tidak aktif' })
          continue
        }

        // C. Check idempotency: does this client_event_id already exist?
        const { data: existingAttendance, error: existErr } = await client
          .from('attendance')
          .select('id')
          .eq('client_event_id', client_event_id)
          .maybeSingle()

        if (existErr) {
          results.push({ client_event_id, status: 'failed', error: 'Gagal memverify duplikat absensi' })
          continue
        }

        if (existingAttendance) {
          results.push({ client_event_id, status: 'success', note: 'already synced' })
          continue
        }

        // D. Convert base64 evidence to buffer
        const imageBuffer = Buffer.from(evidenceBase64, 'base64')
        const evidencePath = `evidence/${client_event_id}.jpg`

        // E. Upload evidence to storage with upsert: true for idempotency
        const { error: uploadErr } = await client.storage
          .from('kiosk-photos')
          .upload(evidencePath, imageBuffer, {
            contentType: 'image/jpeg',
            upsert: true
          })

        if (uploadErr) {
          results.push({ client_event_id, status: 'failed', error: 'Gagal mengunggah foto bukti' })
          continue
        }

        // F. Check for conflicts: Has this worker logged this event type on this day already in project local timezone?
        const offsetHours = await getProjectTimezoneOffset(client, payload.project_id)
        const { startUtcStr, endUtcStr } = getProjectLocalDayBoundaries(payload.occurred_at, offsetHours)

        const { data: duplicateCheck, error: dupErr } = await client
          .from('attendance')
          .select('id')
          .eq('worker_id', payload.worker_id)
          .eq('type', payload.type)
          .gte('occurred_at', startUtcStr)
          .lte('occurred_at', endUtcStr)
          .maybeSingle()

        if (dupErr) {
          // Cleanup uploaded photo on db error
          await client.storage.from('kiosk-photos').remove([evidencePath])
          results.push({ client_event_id, status: 'failed', error: 'Gagal memeriksa konflik absensi' })
          continue
        }

        let dbStatus: 'approved' | 'pending_approval' | 'rejected' = 'approved'
        let conflictOfId: string | null = null

        if (duplicateCheck) {
          dbStatus = 'pending_approval'
          conflictOfId = duplicateCheck.id

          // Mark the original record as pending_approval too
          await client
            .from('attendance')
            .update({ status: 'pending_approval' })
            .eq('id', duplicateCheck.id)
        }

        // G. Insert database record
        const { error: insertErr } = await client
          .from('attendance')
          .insert({
            client_event_id,
            worker_id: payload.worker_id,
            project_id: payload.project_id,
            type: payload.type,
            occurred_at: payload.occurred_at,
            evidence_path: evidencePath,
            gps: payload.gps,
            source: payload.source,
            status: dbStatus,
            conflict_of: conflictOfId
          })

        if (insertErr) {
          // Cleanup uploaded photo on db failure
          await client.storage.from('kiosk-photos').remove([evidencePath])
          results.push({ client_event_id, status: 'failed', error: 'Gagal menyimpan data absensi' })
          continue
        }

        results.push({ client_event_id, status: 'success' })
      } catch {
        results.push({ client_event_id, status: 'failed', error: 'Gagal memproses event' })
      }
    }

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
