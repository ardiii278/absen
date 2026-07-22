import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { verifyAuth, verifyProjectAccess, getProjectTimezoneOffset, createAuditLog } from '@/lib/server-auth'
import { exportRequestSchema } from '@/lib/validators'

// Security: Prevent CSV Injection / Formula injection
function escapeFormula(val: string): string {
  if (!val) return ''
  if (val.startsWith('=') || val.startsWith('+') || val.startsWith('-') || val.startsWith('@')) {
    return `'${val}`
  }
  return val
}

// Convert 1-based column index to Excel column name (e.g. 1 -> A, 27 -> AA)
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

    // 2. Validate request parameter
    const body = await req.json()
    const parsed = exportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { projectId, startDate, endDate } = parsed.data
    const jobScope = body.jobScope || null // Optional filter

    // 3. Verify role (only super_admin and admin are allowed to export payroll)
    if (authContext.profile.role !== 'super_admin' && authContext.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Hanya Admin atau Super Admin yang diizinkan melakukan ekspor' }, { status: 403 })
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

    // 6. Fetch workers (filtered by project and optional jobScope)
    let workerQuery = client
      .from('workers')
      .select('id, name, nik, position, daily_wage, job_scope')
      .eq('project_id', projectId)

    if (jobScope) {
      workerQuery = workerQuery.eq('job_scope', jobScope)
    }

    const { data: workers, error: workersErr } = await workerQuery

    if (workersErr || !workers || workers.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data pekerja untuk kriteria ini' }, { status: 404 })
    }

    // 7. Fetch attendance records in date range
    const { data: attendance, error: attErr } = await client
      .from('attendance')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .gte('occurred_at', `${startDate}T00:00:00Z`)
      .lte('occurred_at', `${endDate}T23:59:59.999Z`)

    if (attErr) {
      return NextResponse.json({ error: 'Gagal mengambil data absensi' }, { status: 500 })
    }

    // 8. Fetch approved overtime records for this project and date range
    const { data: overtimes, error: otErr } = await client
      .from('overtime')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .gte('work_date', startDate)
      .lte('work_date', endDate)

    if (otErr) {
      return NextResponse.json({ error: 'Gagal mengambil data lembur' }, { status: 500 })
    }

    const overtimesList = (overtimes || []) as { id: string; work_date: string }[]
    const overtimeIds = overtimesList.map((ot) => ot.id)

    // 9. Fetch overtime workers mapping if there are any overtime records
    let overtimeMapping: { worker_id: string; hours: number; overtime_id: string }[] = []
    if (overtimeIds.length > 0) {
      const { data: otMap, error: otMapErr } = await client
        .from('overtime_workers')
        .select('worker_id, hours, overtime_id')
        .in('overtime_id', overtimeIds)
      
      if (!otMapErr && otMap) {
        overtimeMapping = otMap
      }
    }

    // Get project timezone offset
    const offsetHours = await getProjectTimezoneOffset(client, projectId)

    // 10. Generate list of dates in range
    const dateList: string[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const current = new Date(start)
    while (current <= end) {
      dateList.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }

    // 11. Generate Excel workbook
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Rekap Kehadiran')

    const totalColumns = 3 + (dateList.length * 2) + 4
    const endHeaderColLetter = getColumnLetter(totalColumns)

    // Header styling
    worksheet.mergeCells(`A1:${endHeaderColLetter}1`)
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `REKAPITULASI ABSENSI & UPAH - PROYEK ${projectName.toUpperCase()}${jobScope ? ` (JOB SCOPE: ${jobScope.toUpperCase()})` : ''}`
    titleCell.font = { size: 14, bold: true }
    titleCell.alignment = { horizontal: 'center' }

    worksheet.mergeCells(`A2:${endHeaderColLetter}2`)
    const periodCell = worksheet.getCell('A2')
    periodCell.value = `Periode: ${startDate} s/d ${endDate}`
    periodCell.font = { italic: true }
    periodCell.alignment = { horizontal: 'center' }

    // Setup Row 3 & 4 for grouped headers
    // Row 3 is Date and Main Headers, Row 4 is MSK & LBR subheaders
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

    // Add Date columns
    dateList.forEach((dateStr, idx) => {
      const colIdx = 4 + (idx * 2) // start at column D (4)
      const colLetter1 = getColumnLetter(colIdx)
      const colLetter2 = getColumnLetter(colIdx + 1)

      // Merge Date Cell
      worksheet.mergeCells(`${colLetter1}3:${colLetter2}3`)
      const dateCell = worksheet.getCell(`${colLetter1}3`)
      
      // Format Date: DD/MM
      const dateParts = dateStr.split('-')
      dateCell.value = `${dateParts[2]}/${dateParts[1]}`
      dateCell.alignment = { horizontal: 'center' }

      // Check if Sunday (Hari Minggu berwarna merah)
      const dayOfWeek = new Date(dateStr).getDay()
      const isSunday = dayOfWeek === 0
      if (isSunday) {
        dateCell.font = { bold: true, color: { argb: 'FFDC2626' } } // red-600 text
        dateCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' } // light red background
        }
      } else {
        dateCell.font = { bold: true }
      }

      // Subheaders in Row 4
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

    // Summary columns headers
    const nextColIdx = 4 + (dateList.length * 2)
    const workDaysColLetter = getColumnLetter(nextColIdx)
    const otHoursColLetter = getColumnLetter(nextColIdx + 1)
    const otRateColLetter = getColumnLetter(nextColIdx + 2)
    const totalWageColLetter = getColumnLetter(nextColIdx + 3)

    worksheet.mergeCells(`${workDaysColLetter}3:${workDaysColLetter}4`)
    const wdHeader = worksheet.getCell(`${workDaysColLetter}3`)
    wdHeader.value = 'Total Hari Kerja'
    wdHeader.font = { bold: true }
    wdHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${otHoursColLetter}3:${otHoursColLetter}4`)
    const otHeader = worksheet.getCell(`${otHoursColLetter}3`)
    otHeader.value = 'Total Lembur'
    otHeader.font = { bold: true }
    otHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${otRateColLetter}3:${otRateColLetter}4`)
    const otrHeader = worksheet.getCell(`${otRateColLetter}3`)
    otrHeader.value = 'Tarif Lembur (Rp)'
    otrHeader.font = { bold: true }
    otrHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    worksheet.mergeCells(`${totalWageColLetter}3:${totalWageColLetter}4`)
    const twHeader = worksheet.getCell(`${totalWageColLetter}3`)
    twHeader.value = 'Total (Rp)'
    twHeader.font = { bold: true }
    twHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    // Column widths for text and summaries
    worksheet.getColumn(1).width = 24 // Nama
    worksheet.getColumn(2).width = 8  // Jabatan
    worksheet.getColumn(3).width = 14 // Harian

    // Set widths for Date columns
    for (let i = 0; i < dateList.length; i++) {
      worksheet.getColumn(4 + (i * 2)).width = 6
      worksheet.getColumn(4 + (i * 2) + 1).width = 6
    }

    worksheet.getColumn(nextColIdx).width = 14
    worksheet.getColumn(nextColIdx + 1).width = 14
    worksheet.getColumn(nextColIdx + 2).width = 16
    worksheet.getColumn(nextColIdx + 3).width = 18

    // Row heights for header
    worksheet.getRow(3).height = 20
    worksheet.getRow(4).height = 18

    let totalWagesSum = 0

    // Add data rows
    const workersList = workers as { id: string; name: string; nik: string; position: string | null; daily_wage: number; job_scope: string }[]
    const attendanceList = (attendance || []) as { worker_id: string | null; occurred_at: string; type: string | null; late_deduction: number }[]

    workersList.forEach((worker, index: number) => {
      const rowNum = index + 5
      const workerAtts = attendanceList.filter((a) => a.worker_id === worker.id)

      // Get project timezone offset
      const workerRowValues: (string | number)[] = [
        escapeFormula(worker.name),
        escapeFormula(worker.position || ''),
        Number(worker.daily_wage || 0)
      ]

      // Populate MSK and LBR for each date
      dateList.forEach((dateStr) => {
        // Filter attendance events of this worker on this local date
        const dayAtts = workerAtts.filter((att) => {
          const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
          const attDateStr = new Date(localTimeMs).toISOString().split('T')[0]
          return attDateStr === dateStr
        })

        // Calculate credit days for this date
        const types = dayAtts.map(att => att.type).filter(Boolean) as ('in' | 'out')[]
        let dayCredit = 0
        if (types.includes('in') && types.includes('out')) {
          dayCredit = 1.0
        } else if (types.includes('in') || types.includes('out')) {
          dayCredit = 0.5
        }

        // Calculate approved overtime hours for this date
        const dayOvertimes = overtimeMapping.filter(
          (ot) => ot.worker_id === worker.id && overtimesList.some(o => o.id === ot.overtime_id)
        )
        // Verify work_date matches
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

      // Add row values
      const addedRow = worksheet.addRow(workerRowValues)

      // Add summary formulas
      const dailyWage = Number(worker.daily_wage || 0)
      
      // Calculate actual values for title/result calculations
      let creditDays = 0
      const daysGroup: { [date: string]: ('in' | 'out')[] } = {}
      workerAtts.forEach((att) => {
        if (!att.occurred_at) return
        const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
        const dateStr = new Date(localTimeMs).toISOString().split('T')[0]
        if (!daysGroup[dateStr]) daysGroup[dateStr] = []
        if (att.type) daysGroup[dateStr].push(att.type as 'in' | 'out')
      })
      Object.values(daysGroup).forEach((types) => {
        if (types.includes('in') && types.includes('out')) creditDays += 1.0
        else if (types.includes('in') || types.includes('out')) creditDays += 0.5
      })

      const otHours = overtimeMapping
        .filter((ot) => ot.worker_id === worker.id)
        .reduce((sum, current) => sum + Number(current.hours), 0)

      const calculatedWage = (creditDays * dailyWage) + (otHours * (dailyWage / 8))
      totalWagesSum += calculatedWage

      // Write formulas for summaries
      // Total Hari Kerja cell (Formula: sum of D{row}, F{row}, etc.)
      const mskCells: string[] = []
      const lbrCells: string[] = []
      dateList.forEach((_, dateIdx) => {
        const colIdx = 4 + (dateIdx * 2)
        mskCells.push(`${getColumnLetter(colIdx)}${rowNum}`)
        lbrCells.push(`${getColumnLetter(colIdx + 1)}${rowNum}`)
      })

      // Formula: sum of MSK subcolumns
      worksheet.getCell(`${workDaysColLetter}${rowNum}`).value = {
        formula: `=SUM(${mskCells.join(',')})`,
        result: creditDays
      }

      // Formula: sum of LBR subcolumns
      worksheet.getCell(`${otHoursColLetter}${rowNum}`).value = {
        formula: `=SUM(${lbrCells.join(',')})`,
        result: otHours
      }

      // Formula: Harian / 8
      worksheet.getCell(`${otRateColLetter}${rowNum}`).value = {
        formula: `=C${rowNum}/8`,
        result: dailyWage / 8
      }

      // Formula: (Total Hari Kerja * Harian) + (Total Lembur * Tarif Lembur)
      worksheet.getCell(`${totalWageColLetter}${rowNum}`).value = {
        formula: `=(${workDaysColLetter}${rowNum}*C${rowNum})+(${otHoursColLetter}${rowNum}*${otRateColLetter}${rowNum})`,
        result: calculatedWage
      }

      // Apply Sunday styling to data row cells
      dateList.forEach((dateStr, dateIdx) => {
        const dayOfWeek = new Date(dateStr).getDay()
        if (dayOfWeek === 0) {
          const colIdx = 4 + (dateIdx * 2)
          const cell1 = addedRow.getCell(colIdx)
          const cell2 = addedRow.getCell(colIdx + 1)
          cell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
          cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        }
      })
    })

    // Add TOTAL row at the bottom
    const totalRowNum = workers.length + 5
    worksheet.getCell(`A${totalRowNum}`).value = 'TOTAL'
    worksheet.getCell(`A${totalRowNum}`).font = { bold: true }
    worksheet.getCell(`${totalWageColLetter}${totalRowNum}`).value = {
      formula: `=SUM(${totalWageColLetter}5:${totalWageColLetter}${totalRowNum - 1})`,
      result: totalWagesSum
    }
    worksheet.getCell(`${totalWageColLetter}${totalRowNum}`).font = { bold: true }

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer

    // Log to audit log
    await createAuditLog(
      client,
      authContext.user.id,
      'projects',
      projectId,
      'EXPORT_EXCEL_PAYROLL',
      `Ekspor Excel rekap upah proyek ${projectName} periode ${startDate} - ${endDate}`
    )

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=rekap_absen_${projectId}.xlsx`
      }
    })
  } catch (err: unknown) {
    console.error('Export error:', err)
    let msg = 'Terjadi kesalahan sistem saat mengekspor Excel'
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
      msg = err.message
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
