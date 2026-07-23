import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, getProjectLocalDayBoundaries, logServerError } from '@/lib/server-auth'
import { supabase } from '@/lib/supabase'
import { syncRequestSchema } from '@/lib/validators'

function distanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6371000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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

        const { data: project, error: projectErr } = await client
          .from('projects')
          .select('lat, lng, radius_m')
          .eq('id', payload.project_id)
          .maybeSingle()

        if (projectErr || !project) {
          results.push({ client_event_id, status: 'failed', error: 'Proyek tidak ditemukan' })
          continue
        }

        if (project.lat !== null && project.lng !== null && project.radius_m !== null) {
          const distance = distanceInMeters(
            payload.gps.latitude,
            payload.gps.longitude,
            Number(project.lat),
            Number(project.lng)
          )
          if (distance > Number(project.radius_m)) {
            results.push({
              client_event_id,
              status: 'failed',
              error: `Lokasi berada ${Math.round(distance)} meter dari proyek (batas ${project.radius_m} meter)`
            })
            continue
          }
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
      } catch (err: unknown) {
        console.error('Sync event error:', err)
        await logServerError(client, '/api/sync (event)', 'POST', err)
        results.push({ client_event_id, status: 'failed', error: 'Gagal memproses event' })
      }
    }

    return NextResponse.json({ results })
  } catch (err: unknown) {
    console.error('Sync general error:', err)
    await logServerError(supabase, '/api/sync', 'POST', err)
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 })
  }
}
