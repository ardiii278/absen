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

    // 6. Fetch workers
    const { data: workers, error: workersErr } = await client
      .from('workers')
      .select('id, name, nik, position, daily_wage')
      .eq('project_id', projectId)

    if (workersErr || !workers || workers.length === 0) {
      return NextResponse.json({ error: 'Tidak ada data pekerja untuk proyek ini' }, { status: 404 })
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

    const overtimesList = (overtimes || []) as { id: string }[]
    const overtimeIds = overtimesList.map((ot) => ot.id)

    // 9. Fetch overtime workers mapping if there are any overtime records
    let overtimeMapping: { worker_id: string; hours: number }[] = []
    if (overtimeIds.length > 0) {
      const { data: otMap, error: otMapErr } = await client
        .from('overtime_workers')
        .select('worker_id, hours')
        .in('overtime_id', overtimeIds)
      
      if (!otMapErr && otMap) {
        overtimeMapping = otMap
      }
    }

    // Get project timezone offset
    const offsetHours = await getProjectTimezoneOffset(client, projectId)

    // 10. Generate Excel workbook
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Rekap Kehadiran')

    // Header styling
    worksheet.mergeCells('A1:G1')
    const titleCell = worksheet.getCell('A1')
    titleCell.value = `REKAPITULASI ABSENSI & UPAH - PROYEK ${projectName.toUpperCase()}`
    titleCell.font = { size: 14, bold: true }
    titleCell.alignment = { horizontal: 'center' }

    worksheet.mergeCells('A2:G2')
    const periodCell = worksheet.getCell('A2')
    periodCell.value = `Periode: ${startDate} s/d ${endDate}`
    periodCell.font = { italic: true }
    periodCell.alignment = { horizontal: 'center' }

    // Table headers
    worksheet.addRow(['Nama Pekerja', 'NIK', 'Jabatan', 'Harian (Rp)', 'Kredit Hari', 'Lembur (Jam)', 'Total Diterima (Rp)'])
    
    let totalWagesSum = 0

    // Add data rows
    const workersList = (workers || []) as { id: string; name: string; nik: string; position: string | null; daily_wage: number }[]
    const attendanceList = (attendance || []) as { worker_id: string | null; occurred_at: string; type: string | null; late_deduction: number }[]

    workersList.forEach((worker, index: number) => {
      const rowNum = index + 5
      const workerAtts = attendanceList.filter((a) => a.worker_id === worker.id)
      
      // Calculate credit days based on project local timezone
      const daysGroup: { [date: string]: ('in' | 'out')[] } = {}
      workerAtts.forEach((att) => {
        if (!att.occurred_at) return
        const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
        const dateStr = new Date(localTimeMs).toISOString().split('T')[0]
        if (!daysGroup[dateStr]) daysGroup[dateStr] = []
        if (att.type) daysGroup[dateStr].push(att.type as 'in' | 'out')
      })

      let creditDays = 0
      Object.values(daysGroup).forEach((types) => {
        if (types.includes('in') && types.includes('out')) {
          creditDays += 1.0
        } else if (types.includes('in') || types.includes('out')) {
          creditDays += 0.5
        }
      })

      // Approved overtime hours for this worker
      const otHours = overtimeMapping
        .filter((ot) => ot.worker_id === worker.id)
        .reduce((sum, current) => sum + Number(current.hours), 0)

      const dailyWage = Number(worker.daily_wage || 0)
      const calculatedWage = (creditDays * dailyWage) + (otHours * (dailyWage / 8))
      totalWagesSum += calculatedWage

      worksheet.getCell(`A${rowNum}`).value = escapeFormula(worker.name)
      worksheet.getCell(`B${rowNum}`).value = escapeFormula(worker.nik)
      worksheet.getCell(`C${rowNum}`).value = escapeFormula(worker.position || '')
      worksheet.getCell(`D${rowNum}`).value = dailyWage
      worksheet.getCell(`E${rowNum}`).value = creditDays
      worksheet.getCell(`F${rowNum}`).value = otHours

      // Excel native formula: (Kredit Hari * Harian) + (Lembur * (Harian/8))
      worksheet.getCell(`G${rowNum}`).value = {
        formula: `(E${rowNum}*D${rowNum})+(F${rowNum}*(D${rowNum}/8))`,
        result: calculatedWage
      }
    })

    // Add TOTAL row at the bottom
    const totalRowNum = workers.length + 5
    worksheet.getCell(`A${totalRowNum}`).value = 'TOTAL'
    worksheet.getCell(`A${totalRowNum}`).font = { bold: true }
    worksheet.getCell(`G${totalRowNum}`).value = {
      formula: `=SUM(G5:G${totalRowNum - 1})`,
      result: totalWagesSum
    }
    worksheet.getCell(`G${totalRowNum}`).font = { bold: true }

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer

    // Log to audit log
    await createAuditLog(
      client,
      authContext.user.id,
      'projects',
      projectId,
      'EXPORT_EXCEL_PAYROLL',
      `Ekspor Excel rekap absensi dan payroll proyek ${projectName} periode ${startDate} - ${endDate}`
    )

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=rekap_absen_${projectId}.xlsx`
      }
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan sistem saat mengekspor Excel' }, { status: 500 })
  }
}
