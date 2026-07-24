'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, MapPin, UserCheck, UsersRound } from 'lucide-react'
import { useGlobalFilter } from '@/components/FilterContext'
import { supabase } from '@/lib/supabase'

type Worker = { id: string; name: string; nik: string; position: string | null; job_scope: string | null; projects: { name: string; lng: number | null } | null }
type Attendance = { worker_id: string | null; occurred_at: string; type: 'in' | 'out' | null }
type Row = { id: string; name: string; nik: string; position: string; project: string; scope: string; present: boolean; inTime: string; outTime: string }

const offsetFor = (lng: number | null) => lng !== null && Number(lng) >= 135 ? 9 : lng !== null && Number(lng) >= 120 ? 8 : 7
const localIso = (value: string, offset: number) => new Date(new Date(value).getTime() + offset * 3600000).toISOString()
const formatDate = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

function today() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export default function DailyWorkforcePage() {
  const { projectId, jobScope } = useGlobalFilter()
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<Row[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase.from('workers').select('id, name, nik, position, job_scope, projects(name, lng)').eq('is_active', true).order('name')
      if (projectId) query = query.eq('project_id', projectId)
      if (jobScope) query = query.eq('job_scope', jobScope)
      const result = await query
      if (result.error) throw result.error
      const workers = (result.data as unknown as Worker[]) || []
      let attendance: Attendance[] = []
      if (workers.length) {
        const start = new Date(`${date}T00:00:00Z`)
        start.setUTCHours(start.getUTCHours() - 9)
        const end = new Date(`${date}T00:00:00Z`)
        end.setUTCDate(end.getUTCDate() + 1)
        end.setUTCHours(end.getUTCHours() - 7)
        const events = await supabase.from('attendance').select('worker_id, occurred_at, type').in('worker_id', workers.map(worker => worker.id)).eq('status', 'approved').gte('occurred_at', start.toISOString()).lt('occurred_at', end.toISOString()).order('occurred_at')
        if (events.error) throw events.error
        attendance = (events.data as Attendance[]) || []
      }
      const nextRows = workers.map(worker => {
        const offset = offsetFor(worker.projects?.lng ?? null)
        const events = attendance.filter(item => item.worker_id === worker.id && localIso(item.occurred_at, offset).slice(0, 10) === date)
        const firstIn = events.find(item => item.type === 'in')
        const lastOut = [...events].reverse().find(item => item.type === 'out')
        return { id: worker.id, name: worker.name, nik: worker.nik, position: worker.position || '-', project: worker.projects?.name || '-', scope: worker.job_scope || '-', present: events.length > 0, inTime: firstIn ? localIso(firstIn.occurred_at, offset).slice(11, 16) : '-', outTime: lastOut ? localIso(lastOut.occurred_at, offset).slice(11, 16) : '-' }
      })
      setRows(nextRows)
      setLocations([...new Set(nextRows.map(row => row.project))].sort())
    } catch (caught: unknown) {
      setRows([])
      setLocations([])
      setError(caught instanceof Error ? caught.message : 'Gagal memuat daftar tenaga harian')
    } finally {
      setLoading(false)
    }
  }, [date, jobScope, projectId])

  useEffect(() => {
    const timeout = setTimeout(load, 0)
    return () => clearTimeout(timeout)
  }, [load])

  const exportExcel = async () => {
    setExporting(true)
    setError(null)
    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Tenaga Harian')
      sheet.addRow([`Daftar Tenaga Harian - ${formatDate(date)}`])
      sheet.mergeCells('A1:H1')
      sheet.addRow(['Nama', 'NIK', 'Posisi', 'Lokasi / Proyek', 'Sub Pekerjaan', 'Status', 'Jam Masuk', 'Jam Keluar'])
      rows.forEach(row => sheet.addRow([row.name, row.nik, row.position, row.project, row.scope, row.present ? 'Hadir' : 'Tidak Hadir', row.inTime, row.outTime]))
      sheet.columns = [28, 20, 12, 28, 28, 18, 14, 14].map(width => ({ width }))
      sheet.getRow(1).font = { bold: true, size: 16 }
      sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
      sheet.views = [{ state: 'frozen', ySplit: 2 }]
      const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `daftar-tenaga-harian-${date}.xlsx`
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      window.setTimeout(() => {
        link.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengekspor Excel')
    } finally {
      setExporting(false)
    }
  }

  const exportPdf = () => {
    const popup = window.open('', '_blank')
    if (!popup) {
      setError('Jendela cetak diblokir browser. Izinkan pop-up untuk mengekspor PDF.')
      return
    }
    const body = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.nik)}</td><td>${escapeHtml(row.position)}</td><td>${escapeHtml(row.project)}</td><td>${escapeHtml(row.scope)}</td><td>${row.present ? 'Hadir' : 'Tidak Hadir'}</td><td>${row.inTime}</td><td>${row.outTime}</td></tr>`).join('')
    popup.document.write(`<!doctype html><html><head><title>Daftar Tenaga Harian ${date}</title><style>@page{size:A4 landscape;margin:12mm}body{font:10px Arial;color:#0f172a}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#047857;color:white}@media print{.hint{display:none}}</style></head><body><h1>Daftar Tenaga Harian</h1><p>${escapeHtml(formatDate(date))} | ${escapeHtml(locations.join(', ') || 'Semua Lokasi / Proyek')}</p><table><thead><tr><th>No.</th><th>Nama</th><th>NIK</th><th>Posisi</th><th>Lokasi / Proyek</th><th>Sub Pekerjaan</th><th>Status</th><th>Masuk</th><th>Keluar</th></tr></thead><tbody>${body}</tbody></table><p class="hint">Pilih tujuan "Save as PDF" pada dialog cetak browser.</p></body></html>`)
    popup.document.close()
    popup.focus()
    setTimeout(() => popup.print(), 250)
  }

  const present = rows.filter(row => row.present).length

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6 lg:p-8 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><h1 className="text-2xl font-bold">Daftar Tenaga Harian</h1><p className="mt-1 text-sm text-slate-500">Kehadiran disetujui dihitung menurut zona waktu lokal setiap proyek.</p></div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold">Tanggal<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
              <button onClick={exportExcel} disabled={loading || exporting || !rows.length} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? 'Mengekspor...' : 'Export Excel'}</button>
              <button onClick={exportPdf} disabled={loading || !rows.length} className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><FileText className="h-4 w-4" />Export PDF</button>
            </div>
          </div>
        </section>
        {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        <section className="grid gap-4 sm:grid-cols-3">
          <Summary icon={MapPin} label="Lokasi / Proyek" value={locations.join(', ') || 'Semua Lokasi / Proyek'} />
          <Summary icon={UsersRound} label="Tenaga Aktif" value={String(rows.length)} />
          <Summary icon={UserCheck} label="Hadir Hari Ini" value={String(present)} />
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900"><tr>{['Nama', 'NIK', 'Posisi', 'Lokasi / Proyek', 'Sub Pekerjaan', 'Status', 'Masuk', 'Keluar'].map(header => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead>
            <tbody>{loading ? <tr><td colSpan={8} className="p-10 text-center text-slate-400">Memuat data...</td></tr> : !rows.length ? <tr><td colSpan={8} className="p-10 text-center text-slate-400">Tidak ada tenaga aktif pada filter ini.</td></tr> : rows.map(row => <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3 font-semibold">{row.name}</td><td className="px-4 py-3 font-mono">{row.nik}</td><td className="px-4 py-3">{row.position}</td><td className="px-4 py-3">{row.project}</td><td className="px-4 py-3">{row.scope}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.present ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.present ? 'Hadir' : 'Tidak Hadir'}</span></td><td className="px-4 py-3 font-mono">{row.inTime}</td><td className="px-4 py-3 font-mono">{row.outTime}</td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </div>
  )
}

function Summary({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase text-slate-400">{label}</p><p className="truncate text-lg font-bold" title={value}>{value}</p></div></div>
}
