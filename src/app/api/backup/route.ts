import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { verifyAuth, verifyProjectAccess, createAuditLog } from '@/lib/server-auth'
import { exportRequestSchema } from '@/lib/validators'

interface WorkerInfo {
  name: string
  nik: string
}

interface AttendanceRecord {
  id: string
  client_event_id: string
  worker_id: string | null
  project_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  evidence_path: string | null
  gps: unknown
  source: string | null
  workers: WorkerInfo | null
}

interface ManifestItem {
  event_id: string
  client_event_id: string
  worker_name: string
  nik: string
  type: 'in' | 'out' | null
  occurred_at: string
  gps: unknown
  photo_file: string | null
  photo_status: string
  error?: string
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
    const parsed = exportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { projectId, startDate, endDate } = parsed.data

    // 3. Verify role (only super_admin and admin are allowed to backup data)
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan melakukan backup' }, { status: 403 })
    }

    // 4. Verify project access
    const hasAccess = await verifyProjectAccess(client, authContext.user.id, authContext.profile.role, projectId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
    }

    // 5. Fetch project name
    const { data: project, error: projErr } = await client
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle()

    if (projErr) {
      return NextResponse.json({ error: 'Gagal mengambil informasi proyek' }, { status: 500 })
    }

    const projectName = project ? project.name : 'Semua Proyek'

    // 6. Fetch attendance records
    const { data: rawAttendance, error: attErr } = await client
      .from('attendance')
      .select('id, client_event_id, worker_id, project_id, type, occurred_at, evidence_path, gps, source, workers(name, nik)')
      .eq('project_id', projectId)
      .gte('occurred_at', `${startDate}T00:00:00Z`)
      .lte('occurred_at', `${endDate}T23:59:59.999Z`)

    if (attErr) {
      return NextResponse.json({ error: 'Gagal mengambil data absensi' }, { status: 500 })
    }

    const attendance = (rawAttendance as unknown as AttendanceRecord[]) || []

    if (attendance.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data absensi untuk dibackup' }, { status: 404 })
    }

    const zip = new JSZip()
    const photosFolder = zip.folder('photos')

    // Create manifest meta file
    const manifest: ManifestItem[] = []

    for (const record of attendance) {
      const dateStr = new Date(record.occurred_at).toISOString().split('T')[0]
      const safeNik = (record.workers?.nik || 'unknown').replace(/[^a-zA-Z0-9]/g, '')
      const safeType = (record.type || 'unknown').replace(/[^a-zA-Z0-9]/g, '')
      const fileName = `${dateStr}_${safeNik}_${safeType}_${record.id.substring(0, 8)}.jpg`

      const manifestItem: ManifestItem = {
        event_id: record.id,
        client_event_id: record.client_event_id,
        worker_name: record.workers?.name || 'Unknown',
        nik: record.workers?.nik || 'Unknown',
        type: record.type,
        occurred_at: record.occurred_at,
        gps: record.gps,
        photo_file: null,
        photo_status: 'no_photo'
      }

      if (record.evidence_path) {
        // Prevent path traversal in storage path
        const isSafePath = record.evidence_path.startsWith('evidence/') && !record.evidence_path.includes('..')
        
        if (isSafePath) {
          // Download proof photo blob from storage
          const { data: fileData, error: downloadErr } = await client.storage
            .from('kiosk-photos')
            .download(record.evidence_path)

          if (downloadErr || !fileData) {
            manifestItem.photo_status = 'failed_download'
            manifestItem.error = 'Gagal mengunduh foto dari storage'
          } else {
            photosFolder?.file(fileName, fileData)
            manifestItem.photo_file = `photos/${fileName}`
            manifestItem.photo_status = 'success'
          }
        } else {
          manifestItem.photo_status = 'unsafe_path'
          manifestItem.error = 'Path foto terindikasi tidak aman'
        }
      }

      manifest.push(manifestItem)
    }

    // Write manifest JSON
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    // Log to audit log
    await createAuditLog(
      client,
      authContext.user.id,
      'projects',
      projectId,
      'ZIP_BACKUP_EXPORTS',
      `Ekspor ZIP bukti foto dan manifest proyek ${projectName} untuk periode ${startDate} - ${endDate}`
    )

    return new Response(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=backup_bukti_${projectId}.zip`
      }
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem saat membuat backup ZIP' }, { status: 500 })
  }
}
