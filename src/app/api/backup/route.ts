import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { createServiceClient, verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, getProjectDateRangeBoundaries, createAuditLog, logServerError } from '@/lib/server-auth'
import { supabase } from '@/lib/supabase'
import { exportRequestSchema } from '@/lib/validators'

// Helper to escape formula injection
function escapeFormula(val: string): string {
  if (!val) return ''
  if (val.startsWith('=') || val.startsWith('+') || val.startsWith('-') || val.startsWith('@')) {
    return `'${val}`
  }
  return val
}

// Convert 1-based column index to Excel column name
function getColumnLetter(colIndex: number): string {
  let temp = colIndex
  let letter = ''
  while (temp > 0) {
    const modulo = (temp - 1) % 26
    letter = String.fromCharCode(65 + modulo) + letter
    temp = Math.floor((temp - modulo) / 26)
  }
  return letter
}

interface WorkerInfo {
  id: string
  name: string
  nik: string
  position: string | null
  daily_wage: number
  job_scope: string
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
    const jobScope = body.jobScope || null

    // 3. Verify role (only super_admin and admin are allowed to backup data)
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan melakukan backup' }, { status: 403 })
    }

    // 4. Verify project access
    const hasAccess = await verifyProjectAccess(client, authContext.user.id, authContext.profile.role, projectId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Akses proyek ditolak' }, { status: 403 })
    }
    const dataClient = createServiceClient()

    // 5. Fetch project name
    const { data: project, error: projErr } = await dataClient
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle()

    if (projErr) {
      return NextResponse.json({ error: 'Gagal mengambil informasi proyek' }, { status: 500 })
    }

    const projectName = project ? project.name : 'Semua Proyek'

    // Fetch workers list (filtered by project and optional jobScope)
    let workerQuery = dataClient
      .from('workers')
      .select('id, name, nik, position, daily_wage, job_scope')
      .eq('project_id', projectId)

    if (jobScope) {
      workerQuery = workerQuery.eq('job_scope', jobScope)
    }

    const { data: workers, error: workersErr } = await workerQuery

    const workersList = (workers || []) as { id: string; name: string; nik: string; position: string | null; daily_wage: number; job_scope: string }[]

    if (workersErr || !workers || workers.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data pekerja untuk kriteria ini' }, { status: 404 })
    }

    const workerIds = workersList.map(w => w.id)

    // 6. Fetch attendance records in date range
    const offsetHours = await getProjectTimezoneOffset(dataClient, projectId)
    const { startUtcStr, endUtcStr } = getProjectDateRangeBoundaries(startDate, endDate, offsetHours)
    const { data: rawAttendance, error: attErr } = await dataClient
      .from('attendance')
      .select('id, client_event_id, worker_id, project_id, type, occurred_at, evidence_path, gps, source, workers(name, nik)')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .in('worker_id', workerIds)
      .gte('occurred_at', startUtcStr)
      .lte('occurred_at', endUtcStr)

    if (attErr) {
      return NextResponse.json({ error: 'Gagal mengambil data absensi' }, { status: 500 })
    }

    const attendance = (rawAttendance as unknown as AttendanceRecord[]) || []

    if (attendance.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data absensi untuk dibackup' }, { status: 404 })
    }

    // 7. Fetch approved overtime records for this project and date range
    const { data: overtimes, error: otErr } = await dataClient
      .from('overtime')
      .select('id, work_date')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .gte('work_date', startDate)
      .lte('work_date', endDate)

    let overtimeMapping: { worker_id: string; hours: number; overtime_id: string }[] = []
    const overtimesList = (overtimes || []) as { id: string; work_date: string }[]
    if (!otErr && overtimes && overtimes.length > 0) {
      const overtimeIds = overtimesList.map(ot => ot.id)
      const { data: otMap, error: otMapErr } = await dataClient
        .from('overtime_workers')
        .select('worker_id, hours, overtime_id')
        .in('overtime_id', overtimeIds)
      if (!otMapErr && otMap) {
        overtimeMapping = otMap
      }
    }

    // 8. Generate list of dates in range
    const dateList: string[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const current = new Date(start)
    while (current <= end) {
      dateList.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }

    // 9. Generate Excel rekap workbook
    const rekapWorkbook = new ExcelJS.Workbook()
    const worksheet = rekapWorkbook.addWorksheet('Rekap Kehadiran')

    const totalColumns = 3 + (dateList.length * 2) + 4
    const endHeaderColLetter = getColumnLetter(totalColumns)

    // Title Row
    worksheet.mergeCells(`A1:${endHeaderColLetter}1`)
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `REKAPITULASI ABSENSI & UPAH - PROYEK ${projectName.toUpperCase()}${jobScope ? ` (JOB SCOPE: ${jobScope.toUpperCase()})` : ''}`
    titleCell.font = { size: 14, bold: true }
    titleCell.alignment = { horizontal: 'center' }

    // Period Row
    worksheet.mergeCells(`A2:${endHeaderColLetter}2`)
    const periodCell = worksheet.getCell('A2')
    periodCell.value = `Periode: ${startDate} s/d ${endDate}`
    periodCell.font = { italic: true }
    periodCell.alignment = { horizontal: 'center' }

    // Grouped headers in Row 3 & 4
    worksheet.mergeCells('A3:A4')
    worksheet.getCell('A3').value = 'Nama Pekerja'
    worksheet.getCell('A3').font = { bold: true }
    worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' }

    worksheet.mergeCells('B3:B4')
    worksheet.getCell('B3').value = 'Jabatan'
    worksheet.getCell('B3').font = { bold: true }
    worksheet.getCell('B3').alignment = { vertical: 'middle', horizontal: 'center' }

    worksheet.mergeCells('C3:C4')
    worksheet.getCell('C3').value = 'Harian (Rp)'
    worksheet.getCell('C3').font = { bold: true }
    worksheet.getCell('C3').alignment = { vertical: 'middle', horizontal: 'center' }

    // Date headers
    dateList.forEach((dateStr, idx) => {
      const colIdx = 4 + (idx * 2)
      const colLetter1 = getColumnLetter(colIdx)
      const colLetter2 = getColumnLetter(colIdx + 1)

      worksheet.mergeCells(`${colLetter1}3:${colLetter2}3`)
      const dateCell = worksheet.getCell(`${colLetter1}3`)
      const dateParts = dateStr.split('-')
      dateCell.value = `${dateParts[2]}/${dateParts[1]}`
      dateCell.alignment = { horizontal: 'center' }

      const isSunday = new Date(dateStr).getDay() === 0
      if (isSunday) {
        dateCell.font = { bold: true, color: { argb: 'FFDC2626' } }
        dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
      } else {
        dateCell.font = { bold: true }
      }

      const mskCell = worksheet.getCell(`${colLetter1}4`)
      mskCell.value = 'MSK'
      mskCell.font = { bold: true, size: 9 }
      mskCell.alignment = { horizontal: 'center' }

      const lbrCell = worksheet.getCell(`${colLetter2}4`)
      lbrCell.value = 'LBR'
      lbrCell.font = { bold: true, size: 9 }
      lbrCell.alignment = { horizontal: 'center' }

      if (isSunday) {
        mskCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        lbrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        mskCell.font = { bold: true, size: 9, color: { argb: 'FFDC2626' } }
        lbrCell.font = { bold: true, size: 9, color: { argb: 'FFDC2626' } }
      }
    })

    // Summary columns
    const nextColIdx = 4 + (dateList.length * 2)
    const workDaysColLetter = getColumnLetter(nextColIdx)
    const otHoursColLetter = getColumnLetter(nextColIdx + 1)
    const otRateColLetter = getColumnLetter(nextColIdx + 2)
    const totalWageColLetter = getColumnLetter(nextColIdx + 3)

    worksheet.mergeCells(`${workDaysColLetter}3:${workDaysColLetter}4`)
    worksheet.getCell(`${workDaysColLetter}3`).value = 'Total Hari Kerja'
    worksheet.getCell(`${workDaysColLetter}3`).font = { bold: true }
    worksheet.getCell(`${workDaysColLetter}3`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${otHoursColLetter}3:${otHoursColLetter}4`)
    worksheet.getCell(`${otHoursColLetter}3`).value = 'Total Lembur'
    worksheet.getCell(`${otHoursColLetter}3`).font = { bold: true }
    worksheet.getCell(`${otHoursColLetter}3`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${otRateColLetter}3:${otRateColLetter}4`)
    worksheet.getCell(`${otRateColLetter}3`).value = 'Tarif Lembur (Rp)'
    worksheet.getCell(`${otRateColLetter}3`).font = { bold: true }
    worksheet.getCell(`${otRateColLetter}3`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${totalWageColLetter}3:${totalWageColLetter}4`)
    worksheet.getCell(`${totalWageColLetter}3`).value = 'Total (Rp)'
    worksheet.getCell(`${totalWageColLetter}3`).font = { bold: true }
    worksheet.getCell(`${totalWageColLetter}3`).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.getColumn(1).width = 24 // Nama
    worksheet.getColumn(2).width = 8  // Jabatan
    worksheet.getColumn(3).width = 14 // Harian

    for (let i = 0; i < dateList.length; i++) {
      worksheet.getColumn(4 + (i * 2)).width = 6
      worksheet.getColumn(4 + (i * 2) + 1).width = 6
    }

    worksheet.getColumn(nextColIdx).width = 14
    worksheet.getColumn(nextColIdx + 1).width = 14
    worksheet.getColumn(nextColIdx + 2).width = 16
    worksheet.getColumn(nextColIdx + 3).width = 18

    // Number format with thousand separators (e.g. 150,000)
    worksheet.getColumn(3).numFmt = '#,##0'
    worksheet.getColumn(nextColIdx + 2).numFmt = '#,##0'
    worksheet.getColumn(nextColIdx + 3).numFmt = '#,##0'

    worksheet.getRow(3).height = 20
    worksheet.getRow(4).height = 18

    let totalWagesSum = 0

    // Add data rows
    workersList.forEach((worker, index: number) => {
      const rowNum = index + 5
      const workerAtts = attendance.filter(a => a.worker_id === worker.id)

      const workerRowValues: (string | number)[] = [
        escapeFormula(worker.name),
        escapeFormula(worker.position || ''),
        Number(worker.daily_wage || 0)
      ]

      dateList.forEach(dateStr => {
        const dayAtts = workerAtts.filter(att => {
          const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
          const attDateStr = new Date(localTimeMs).toISOString().split('T')[0]
          return attDateStr === dateStr
        })

        const types = dayAtts.map(att => att.type).filter(Boolean) as ('in' | 'out')[]
        let dayCredit = 0
        if (types.includes('in') && types.includes('out')) {
          dayCredit = 1.0
        } else if (types.includes('in') || types.includes('out')) {
          dayCredit = 0.5
        }

        const dayOvertimes = overtimeMapping.filter(
          ot => ot.worker_id === worker.id && overtimesList.some(o => o.id === ot.overtime_id)
        )
        let dayOtHours = 0
        dayOvertimes.forEach(ot => {
          const otRecord = overtimesList.find(o => o.id === ot.overtime_id)
          if (otRecord) {
            const otDateStr = new Date(otRecord.work_date).toISOString().split('T')[0]
            if (otDateStr === dateStr) {
              dayOtHours += Number(ot.hours) || 0
            }
          }
        })

        workerRowValues.push(dayCredit > 0 ? dayCredit : '')
        workerRowValues.push(dayOtHours > 0 ? dayOtHours : '')
      })

      const addedRow = worksheet.addRow(workerRowValues)

      const dailyWage = Number(worker.daily_wage || 0)
      let creditDays = 0
      const daysGroup: { [date: string]: ('in' | 'out')[] } = {}
      workerAtts.forEach(att => {
        const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
        const dateStr = new Date(localTimeMs).toISOString().split('T')[0]
        if (!daysGroup[dateStr]) daysGroup[dateStr] = []
        if (att.type) daysGroup[dateStr].push(att.type as 'in' | 'out')
      })
      Object.values(daysGroup).forEach(types => {
        if (types.includes('in') && types.includes('out')) creditDays += 1.0
        else if (types.includes('in') || types.includes('out')) creditDays += 0.5
      })

      const otHours = overtimeMapping
        .filter(ot => ot.worker_id === worker.id)
        .reduce((sum, current) => sum + Number(current.hours), 0)

      const calculatedWage = (creditDays * dailyWage) + (otHours * (dailyWage / 8))
      totalWagesSum += calculatedWage

      const mskCells: string[] = []
      const lbrCells: string[] = []
      dateList.forEach((_, dateIdx) => {
        const colIdx = 4 + (dateIdx * 2)
        mskCells.push(`${getColumnLetter(colIdx)}${rowNum}`)
        lbrCells.push(`${getColumnLetter(colIdx + 1)}${rowNum}`)
      })

      worksheet.getCell(`${workDaysColLetter}${rowNum}`).value = {
        formula: `=SUM(${mskCells.join(',')})`,
        result: creditDays
      }

      worksheet.getCell(`${otHoursColLetter}${rowNum}`).value = {
        formula: `=SUM(${lbrCells.join(',')})`,
        result: otHours
      }

      worksheet.getCell(`${otRateColLetter}${rowNum}`).value = {
        formula: `=C${rowNum}/8`,
        result: dailyWage / 8
      }

      worksheet.getCell(`${totalWageColLetter}${rowNum}`).value = {
        formula: `=(${workDaysColLetter}${rowNum}*C${rowNum})+(${otHoursColLetter}${rowNum}*${otRateColLetter}${rowNum})`,
        result: calculatedWage
      }

      dateList.forEach((dateStr, dateIdx) => {
        if (new Date(dateStr).getDay() === 0) {
          const colIdx = 4 + (dateIdx * 2)
          addedRow.getCell(colIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
          addedRow.getCell(colIdx + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        }
      })
    })

    const totalRowNum = workers.length + 5
    worksheet.getCell(`A${totalRowNum}`).value = 'TOTAL'
    worksheet.getCell(`A${totalRowNum}`).font = { bold: true }
    worksheet.getCell(`${totalWageColLetter}${totalRowNum}`).value = {
      formula: `=SUM(${totalWageColLetter}5:${totalWageColLetter}${totalRowNum - 1})`,
      result: totalWagesSum
    }
    worksheet.getCell(`${totalWageColLetter}${totalRowNum}`).font = { bold: true }

    // 10. Generate ZIP Archive
    const zip = new JSZip()
    
    // Add rekap.xlsx to root of ZIP
    const excelBuffer = await rekapWorkbook.xlsx.writeBuffer()
    zip.file('rekap.xlsx', excelBuffer)

    const photosFolder = zip.folder('photos')
    const manifest: ManifestItem[] = []

    for (const record of attendance) {
      const dateStr = new Date(record.occurred_at).toISOString().split('T')[0]
      const safeName = (record.workers?.name || 'unknown').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_')
      const timePart = new Date(record.occurred_at).toISOString().replace(/[:.]/g, '-')
      const fileName = `${safeName}_${record.type || 'unknown'}_${timePart}_${record.id}.jpg`

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
        const isSafePath = record.evidence_path.startsWith('evidence/') && !record.evidence_path.includes('..')
        
        if (isSafePath) {
          const { data: fileData, error: downloadErr } = await dataClient.storage
            .from('kiosk-photos')
            .download(record.evidence_path)

          if (downloadErr || !fileData) {
            manifestItem.photo_status = 'failed_download'
            manifestItem.error = 'Gagal mengunduh foto dari storage'
          } else {
            const arrayBuffer = await fileData.arrayBuffer()
            const dateFolder = photosFolder?.folder(dateStr)
            dateFolder?.file(fileName, Buffer.from(arrayBuffer))
            manifestItem.photo_file = `photos/${dateStr}/${fileName}`
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
      `Ekspor ZIP bukti foto dan rekap.xlsx proyek ${projectName}${jobScope ? ` (job scope: ${jobScope})` : ''} untuk periode ${startDate} - ${endDate}`
    )

    return new Response(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=backup_bukti_${projectName.replace(/[^a-zA-Z0-9\-_]/g, '_')}.zip`
      }
    })
  } catch (err: unknown) {
    console.error('Backup error:', err)
    await logServerError(supabase, '/api/backup', 'POST', err)
    return NextResponse.json({ error: 'Terjadi kesalahan sistem saat membuat backup ZIP' }, { status: 500 })
  }
}
