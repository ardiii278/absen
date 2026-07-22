import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, createAuditLog } from '@/lib/server-auth'
import { exportRequestSchema } from '@/lib/validators'

function escapeFormula(val: string): string {
  if (!val) return ''
  if (val.startsWith('=') || val.startsWith('+') || val.startsWith('-') || val.startsWith('@')) {
    return `'${val}`
  }
  return val
}

interface AttendanceRecord {
  id: string
  worker_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  evidence_path: string | null
  source: string | null
  status: string
  workers: { name: string; nik: string } | null
}

export async function POST(req: NextRequest) {
  try {
    let authContext
    try {
      authContext = await verifyAuth(req)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : ''
      const msg = errorMsg === 'FORBIDDEN' ? 'Akses ditolak' : 'Sesi tidak valid atau tidak ditemukan'
      return NextResponse.json({ error: msg }, { status: errorMsg === 'FORBIDDEN' ? 403 : 401 })
    }

    const { client } = authContext

    const body = await req.json()
    const parsed = exportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { projectId, startDate, endDate } = parsed.data

    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const hasAccess = await verifyProjectAccess(client, authContext.user.id, authContext.profile.role, projectId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
    }

    const { data: project } = await client
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle()

    const projectName = project ? project.name : 'Proyek'

    const offsetHours = await getProjectTimezoneOffset(client, projectId)

    // Fetch all attendance records
    const { data: rawAttendance, error: attErr } = await client
      .from('attendance')
      .select('id, worker_id, type, occurred_at, evidence_path, source, status, workers(name, nik)')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .gte('occurred_at', `${startDate}T00:00:00Z`)
      .lte('occurred_at', `${endDate}T23:59:59.999Z`)
      .order('occurred_at', { ascending: true })

    if (attErr) {
      return NextResponse.json({ error: 'Gagal mengambil data absensi' }, { status: 500 })
    }

    const attendance = (rawAttendance as unknown as AttendanceRecord[]) || []

    if (attendance.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data absensi untuk periode ini' }, { status: 404 })
    }

    // Sort by worker name, then by time
    const sorted = [...attendance].sort((a, b) => {
      const nameA = a.workers?.name || ''
      const nameB = b.workers?.name || ''
      if (nameA !== nameB) return nameA.localeCompare(nameB)
      return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    })

    const masukCount = sorted.filter(a => a.type === 'in').length
    const pulangCount = sorted.filter(a => a.type === 'out').length

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Absensi Harian')

    // Header
    worksheet.mergeCells('A1:F1')
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `REKAP ABSENSI HARIAN - ${projectName.toUpperCase()}`
    titleCell.font = { size: 13, bold: true }
    titleCell.alignment = { horizontal: 'center' }

    worksheet.mergeCells('A2:F2')
    const infoCell = worksheet.getCell('A2')
    infoCell.value = `Periode: ${startDate} s/d ${endDate} | Masuk: ${masukCount} | Pulang: ${pulangCount}`
    infoCell.font = { italic: true, size: 10 }
    infoCell.alignment = { horizontal: 'center' }

    // Column headers
    worksheet.addRow(['No', 'Tanggal', 'Jam', 'Nama Pekerja', 'Tipe', 'Foto Bukti'])

    const headerRow = worksheet.getRow(3)
    headerRow.font = { bold: true, size: 10 }
    headerRow.height = 22

    // Column widths
    worksheet.getColumn(1).width = 5    // No
    worksheet.getColumn(2).width = 14   // Tanggal
    worksheet.getColumn(3).width = 8    // Jam
    worksheet.getColumn(4).width = 26   // Nama
    worksheet.getColumn(5).width = 10   // Tipe
    worksheet.getColumn(6).width = 22   // Foto

    const PHOTO_WIDTH = 120
    const PHOTO_HEIGHT = 90
    const ROW_HEIGHT_PT = 75

    // Build rows
    for (let i = 0; i < sorted.length; i++) {
      const att = sorted[i]
      const rowNum = i + 4

      // Convert to local project time
      const utcMs = new Date(att.occurred_at).getTime()
      const localMs = utcMs + (offsetHours * 60 * 60 * 1000)
      const localDate = new Date(localMs)

      const dateStr = localDate.toISOString().split('T')[0]
      const timeStr = localDate.toISOString().split('T')[1].substring(0, 5)

      const row = worksheet.addRow([
        i + 1,
        dateStr,
        timeStr,
        escapeFormula(att.workers?.name || '-'),
        att.type === 'in' ? 'MASUK' : 'PULANG',
        ''
      ])

      row.height = ROW_HEIGHT_PT

      // Style Tipe cell
      const tipeCell = row.getCell(5)
      if (att.type === 'in') {
        tipeCell.font = { bold: true, color: { argb: 'FF047857' } } // emerald-700
      } else {
        tipeCell.font = { bold: true, color: { argb: 'FFDC2626' } } // red-600
      }

      // Embed photo
      if (att.evidence_path) {
        try {
          const { data: fileData, error: downloadErr } = await client.storage
            .from('kiosk-photos')
            .download(att.evidence_path)

          if (!downloadErr && fileData) {
            const arrayBuffer = await fileData.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            const imageId = workbook.addImage({
              buffer: buffer as unknown as ExcelJS.Buffer,
              extension: 'jpeg'
            })

            worksheet.addImage(imageId, {
              tl: { col: 5, row: rowNum - 1 },
              ext: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT }
            })
          }
        } catch {
          // Photo download failed
        }
      }
    }

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer

    await createAuditLog(
      client,
      authContext.user.id,
      'projects',
      projectId,
      'EXPORT_DAILY_ATTENDANCE',
      `Ekspor absen harian proyek ${projectName} periode ${startDate} - ${endDate}`
    )

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=absen_harian_${projectId}_${startDate}_${endDate}.xlsx`
      }
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem saat mengekspor' }, { status: 500 })
  }
}
