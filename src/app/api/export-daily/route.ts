import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServiceClient, verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, getProjectDateRangeBoundaries, createAuditLog, logServerError } from '@/lib/server-auth'

function formatLocalTime(utcTimeStr: string, offsetHours: number): string {
  const ms = new Date(utcTimeStr).getTime() + (offsetHours * 60 * 60 * 1000)
  const d = new Date(ms)
  return d.toISOString().substring(11, 16)
}
import { supabase } from '@/lib/supabase'
import { exportRequestSchema } from '@/lib/validators'

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
    const jobScope = body.jobScope || null

    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan' }, { status: 403 })
    }

    const hasAccess = await verifyProjectAccess(client, authContext.user.id, authContext.profile.role, projectId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
    }
    const dataClient = createServiceClient()

    const { data: project } = await dataClient
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle()

    const projectName = project ? project.name : 'Proyek'

    const offsetHours = await getProjectTimezoneOffset(dataClient, projectId)
    const { startUtcStr, endUtcStr } = getProjectDateRangeBoundaries(startDate, endDate, offsetHours)

    // Fetch workers list first to filter by job scope
    let workerQuery = dataClient
      .from('workers')
      .select('id')
      .eq('project_id', projectId)

    if (jobScope) {
      workerQuery = workerQuery.eq('job_scope', jobScope)
    }

    const { data: workersList } = await workerQuery
    const workerIds = (workersList || []).map((w: { id: string }) => w.id)

    if (workerIds.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data pekerja untuk kriteria ini' }, { status: 404 })
    }

    // Fetch all attendance records
    const { data: rawAttendance, error: attErr } = await dataClient
      .from('attendance')
      .select('id, worker_id, type, occurred_at, evidence_path, source, status, workers(name, nik)')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .in('worker_id', workerIds)
      .gte('occurred_at', startUtcStr)
      .lte('occurred_at', endUtcStr)
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

    const titleRow = worksheet.addRow(['REKAP ABSENSI HARIAN'])
    worksheet.mergeCells('A1:F1')
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `REKAP ABSENSI HARIAN - ${projectName.toUpperCase()}${jobScope ? ` (JOB SCOPE: ${jobScope.toUpperCase()})` : ''}`
    titleCell.font = { size: 14, bold: true, color: { argb: 'FF1E293B' } }
    titleCell.alignment = { horizontal: 'center' }
    titleRow.height = 28

    const infoRow = worksheet.addRow([`Periode: ${startDate} s/d ${endDate} | Masuk: ${masukCount} | Pulang: ${pulangCount}`])
    worksheet.mergeCells('A2:F2')
    const infoCell = worksheet.getCell('A2')
    infoCell.font = { italic: true, size: 9, color: { argb: 'FF64748B' } }
    infoCell.alignment = { horizontal: 'center' }
    infoRow.height = 22

    const spacerRow = worksheet.addRow([])
    spacerRow.height = 8

    const COL_WIDTHS = [4.5, 12, 10, 24, 28, 28]
    for (let c = 0; c < 6; c++) worksheet.getColumn(c + 1).width = COL_WIDTHS[c]

    const SECTION_YELLOW = 'FFFEF3C7'
    const HEADER_BLUE = 'FFDBEAFE'
    const MASUK_GREEN = 'FF047857'
    const PULANG_RED = 'FFDC2626'
    const PHOTO_W = 170
    const PHOTO_H = 125
    const ROW_H = 100

    let currentRow = 4
    let workerIndex = 0

    const workerPairs = new Map<string, { name: string; in: (typeof sorted)[0] | null; out: (typeof sorted)[0] | null }>()
    for (const att of sorted) {
      const key = att.worker_id || 'unknown'
      if (!workerPairs.has(key)) workerPairs.set(key, { name: att.workers?.name || 'Tidak Dikenal', in: null, out: null })
      const pair = workerPairs.get(key)!
      if (att.type === 'in') pair.in = att
      else pair.out = att
    }

    const embedPhoto = async (path: string | null | undefined): Promise<number | null> => {
      if (!path) return null
      try {
        const { data, error } = await dataClient.storage.from('kiosk-photos').download(path)
        if (error || !data) return null
        const buf = Buffer.from(await data.arrayBuffer())
        return workbook.addImage({ buffer: buf as unknown as ExcelJS.Buffer, extension: 'jpeg' })
      } catch {
        return null
      }
    }

    for (const [, pair] of workerPairs) {
      const photoInId = await embedPhoto(pair.in?.evidence_path)
      const photoOutId = await embedPhoto(pair.out?.evidence_path)

      const timeInStr = pair.in ? formatLocalTime(pair.in.occurred_at, offsetHours) : '-'
      const timeOutStr = pair.out ? formatLocalTime(pair.out.occurred_at, offsetHours) : '-'

      worksheet.addRow([]).height = 4
      currentRow++

      worksheet.addRow([`${workerIndex + 1}.  ${pair.name.toUpperCase()}`])
      worksheet.mergeCells(currentRow, 1, currentRow, 6)
      const sectionCell = worksheet.getCell(currentRow, 1)
      sectionCell.font = { bold: true, size: 11, color: { argb: 'FF1E293B' } }
      sectionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_YELLOW } }
      sectionCell.alignment = { horizontal: 'left' }
      worksheet.getRow(currentRow).height = 26
      currentRow++

      worksheet.addRow(['', 'MASUK', '', '', 'PULANG', ''])
      worksheet.mergeCells(currentRow, 2, currentRow, 3)
      worksheet.mergeCells(currentRow, 5, currentRow, 6)
      const hRow = worksheet.getRow(currentRow)

      for (let c = 2; c <= 6; c++) {
        const cell = hRow.getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BLUE } }
        cell.font = { bold: true, size: 9 }
        cell.alignment = { horizontal: 'center' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF93C5FD' } },
          bottom: { style: 'thin', color: { argb: 'FF93C5FD' } }
        }
      }
      worksheet.getCell(currentRow, 2).value = 'MASUK'
      worksheet.getCell(currentRow, 5).value = 'PULANG'
      hRow.height = 20
      currentRow++

      worksheet.addRow(['', 'Jam', 'Foto', '', 'Jam', 'Foto'])
      const lRow = worksheet.getRow(currentRow)
      for (let c = 2; c <= 6; c++) {
        const cell = lRow.getCell(c)
        cell.font = { size: 8, color: { argb: 'FF64748B' } }
        cell.alignment = { horizontal: 'center' }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
      lRow.height = 18
      currentRow++

      worksheet.addRow(['', timeInStr, '', '', timeOutStr, ''])
      const dRow = worksheet.getRow(currentRow)
      dRow.height = ROW_H

      dRow.getCell(2).font = { bold: true, size: 10, color: { argb: MASUK_GREEN } }
      dRow.getCell(2).alignment = { vertical: 'top', horizontal: 'center' }
      dRow.getCell(5).font = { bold: true, size: 10, color: { argb: PULANG_RED } }
      dRow.getCell(5).alignment = { vertical: 'top', horizontal: 'center' }

      for (let c = 1; c <= 6; c++) {
        const cell = dRow.getCell(c)
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      }

      if (photoInId !== null) {
        worksheet.addImage(photoInId, {
          tl: { col: 2, row: currentRow - 1 },
          ext: { width: PHOTO_W, height: PHOTO_H }
        })
      } else {
        dRow.getCell(3).value = 'Tidak ada foto'
        dRow.getCell(3).font = { italic: true, size: 8, color: { argb: 'FF94A3B8' } }
        dRow.getCell(3).alignment = { horizontal: 'center' }
      }

      if (photoOutId !== null) {
        worksheet.addImage(photoOutId, {
          tl: { col: 4, row: currentRow - 1 },
          ext: { width: PHOTO_W, height: PHOTO_H }
        })
      } else {
        dRow.getCell(6).value = 'Tidak ada foto'
        dRow.getCell(6).font = { italic: true, size: 8, color: { argb: 'FF94A3B8' } }
        dRow.getCell(6).alignment = { horizontal: 'center' }
      }

      currentRow++
      workerIndex++
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
        'Content-Disposition': `attachment; filename="absen_harian_${projectName.replace(/[^a-zA-Z0-9\-_]/g, '_')}_${startDate}_${endDate}.xlsx"`,
        'Cache-Control': 'no-store'
      }
    })
  } catch (err: unknown) {
    console.error('Export daily error:', err)
    await logServerError(supabase, '/api/export-daily', 'POST', err)
    return NextResponse.json({ error: 'Terjadi kesalahan sistem saat mengekspor' }, { status: 500 })
  }
}
