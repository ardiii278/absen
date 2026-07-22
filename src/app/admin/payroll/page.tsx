'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface PayrollRow {
  workerId: string
  name: string
  nik: string
  position: string
  dailyWage: number
  workDays: number
  lateDeduction: number
  overtimePay: number
  totalPay: number
}

interface WorkerRawData {
  id: string
  name: string
  nik: string
  position: 'TK' | 'KN' | null
  daily_wage: number
  project_id: string
  projects: {
    lng: number | null
  } | null
}

interface AttendanceRawData {
  worker_id: string | null
  occurred_at: string
  type: 'in' | 'out' | null
  late_deduction: number
}

interface OvertimeWorkerRawData {
  worker_id: string
  hours: number
  overtime: {
    status: 'pending_approval' | 'approved' | 'rejected'
  } | null
}

export default function PayrollPage() {
  const [payrollData, setPayrollData] = useState<PayrollRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchPayroll = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      // 1. Fetch Workers with project's longitude
      const { data: rawWorkers, error: workerErr } = await supabase
        .from('workers')
        .select('id, name, nik, position, daily_wage, project_id, projects(lng)')
        .eq('is_active', true)

      if (workerErr) throw workerErr
      if (!rawWorkers) return

      const workers = (rawWorkers as unknown as WorkerRawData[])

      // 2. Fetch Attendance for calculation
      const { data: rawAttendance, error: attErr } = await supabase
        .from('attendance')
        .select('worker_id, occurred_at, type, late_deduction')
        .eq('status', 'approved')

      if (attErr) throw attErr
      
      const attendance = (rawAttendance as unknown as AttendanceRawData[]) || []

      // 3. Fetch Overtime mapping
      const { data: rawOtWorkers, error: otErr } = await supabase
        .from('overtime_workers')
        .select('worker_id, hours, overtime(status)')

      if (otErr) throw otErr

      const otWorkers = (rawOtWorkers as unknown as OvertimeWorkerRawData[]) || []

      // Group attendance events by worker & date to count credit days
      const payrollList: PayrollRow[] = workers.map(worker => {
        const workerAtts = attendance.filter(a => a.worker_id === worker.id)
        
        // Group by local project date key (YYYY-MM-DD)
        let offsetHours = 7 // Default WIB
        if (worker.projects && worker.projects.lng !== null) {
          const lng = Number(worker.projects.lng)
          if (lng >= 135.0) {
            offsetHours = 9 // WIT
          } else if (lng >= 120.0) {
            offsetHours = 8 // WITA
          }
        }

        const daysGroup: { [date: string]: ('in' | 'out')[] } = {}
        let totalDeduction = 0

        workerAtts.forEach(att => {
          if (!att.occurred_at) return
          const localTimeMs = new Date(att.occurred_at).getTime() + (offsetHours * 60 * 60 * 1000)
          const dateStr = new Date(localTimeMs).toISOString().split('T')[0]
          
          if (!daysGroup[dateStr]) daysGroup[dateStr] = []
          if (att.type) daysGroup[dateStr].push(att.type)
          totalDeduction += Number(att.late_deduction) || 0
        })

        // PRD calculation: 1 event = 0.5 days; in-out pair = 1.0 day
        let creditDays = 0
        Object.values(daysGroup).forEach(types => {
          const hasIn = types.includes('in')
          const hasOut = types.includes('out')
          if (hasIn && hasOut) {
            creditDays += 1.0
          } else if (hasIn || hasOut) {
            creditDays += 0.5
          }
        })

        // Calculate Overtime hours (only approved ones)
        const approvedOtHours = otWorkers
          .filter(ot => ot.worker_id === worker.id && ot.overtime?.status === 'approved')
          .reduce((sum, current) => sum + Number(current.hours), 0)

        // Formula: daily_wage/8 rate per hour
        const hourlyRate = Number(worker.daily_wage) / 8
        const overtimePay = approvedOtHours * hourlyRate

        // Total Wage Formula: (credit_day × daily_wage) - late_deduction + overtime_pay
        const basePay = creditDays * Number(worker.daily_wage)
        const totalPay = Math.max(0, basePay - totalDeduction + overtimePay)

        return {
          workerId: worker.id,
          name: worker.name,
          nik: worker.nik,
          position: worker.position || '',
          dailyWage: Number(worker.daily_wage),
          workDays: creditDays,
          lateDeduction: totalDeduction,
          overtimePay,
          totalPay
        }
      })

      setPayrollData(payrollList)
    } catch (err: unknown) {
      let msg = 'Gagal memuat data payroll'
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        msg = err.message
      }
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchPayroll()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchPayroll])

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
        <h1 className="text-2xl font-bold mb-6 text-slate-800">Rekap Pengupahan Pekerja</h1>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {errorMsg}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 text-sm font-semibold">
                <th className="py-3 px-4">Nama Pekerja</th>
                <th className="py-3 px-4">NIK</th>
                <th className="py-3 px-4">Harian (Rp)</th>
                <th className="py-3 px-4">Kredit Hari</th>
                <th className="py-3 px-4">Lembur (Rp)</th>
                <th className="py-3 px-4">Potongan (Rp)</th>
                <th className="py-3 px-4 text-right">Total Diterima (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Memuat data...</td>
                </tr>
              ) : payrollData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">Tidak ada data payroll aktif.</td>
                </tr>
              ) : (
                payrollData.map(row => (
                  <tr key={row.workerId} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-xs text-slate-400">{row.position}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-sm">{row.nik}</td>
                    <td className="py-3 px-4 font-mono text-sm">
                      Rp {row.dailyWage.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 font-medium">{row.workDays} Hari</td>
                    <td className="py-3 px-4 font-mono text-sm">
                      Rp {row.overtimePay.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 font-mono text-sm text-red-600">
                      - Rp {row.lateDeduction.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-800 text-lg">
                      Rp {row.totalPay.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
