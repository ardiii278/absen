'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Period = 'day' | 'week' | 'month' | 'custom'
interface AttendanceRow {
  id: string
  worker_id: string | null
  type: 'in' | 'out' | null
  occurred_at: string
  source: string | null
  workers: { name: string; position: string | null } | null
}
interface Pair {
  key: string
  name: string
  position: string
  date: string
  clockIn: string
  clockOut: string
  method: string
}

const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

export default function UserHistoryPage() {
  const router = useRouter()
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('Riwayat Absensi')
  const [period, setPeriod] = useState<Period>('day')
  const [startDate, setStartDate] = useState(localDate)
  const [endDate, setEndDate] = useState(localDate)
  const [rows, setRows] = useState<Pair[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = localStorage.getItem('kiosk_project_id')
      if (!stored) router.replace('/login')
      else setProjectId(stored)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [router])

  const selectPeriod = (value: Period) => {
    setPeriod(value)
    if (value === 'custom') return
    const end = new Date(`${localDate()}T00:00:00`)
    const start = new Date(end)
    if (value === 'week') start.setDate(start.getDate() - 6)
    if (value === 'month') start.setDate(start.getDate() - 29)
    setStartDate(start.toLocaleDateString('en-CA'))
    setEndDate(end.toLocaleDateString('en-CA'))
  }

  const loadHistory = useCallback(async () => {
    if (!projectId) return
    const days = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1
    if (days < 1 || days > 31) {
      setError('Rentang tanggal maksimal 31 hari.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [{ data: project }, attendance] = await Promise.all([
        supabase.from('projects').select('name').eq('id', projectId).maybeSingle(),
        supabase.from('attendance')
          .select('id, worker_id, type, occurred_at, source, workers(name, position)')
          .eq('project_id', projectId)
          .eq('status', 'approved')
          .gte('occurred_at', `${startDate}T00:00:00+07:00`)
          .lte('occurred_at', `${endDate}T23:59:59.999+07:00`)
          .order('occurred_at', { ascending: true })
      ])
      if (attendance.error) throw attendance.error
      if (project) setProjectName(project.name)
      const map = new Map<string, Pair>()
      for (const record of (attendance.data as unknown as AttendanceRow[]) || []) {
        const timestamp = new Date(record.occurred_at)
        const date = timestamp.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
        const time = timestamp.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
        const key = `${record.worker_id}:${date}`
        const pair = map.get(key) || { key, name: record.workers?.name || 'Tidak Dikenal', position: record.workers?.position || '-', date, clockIn: '-', clockOut: '-', method: record.source || '-' }
        if (record.type === 'in' && pair.clockIn === '-') pair.clockIn = time
        if (record.type === 'out') pair.clockOut = time
        if (pair.method !== record.source) pair.method = 'campuran'
        map.set(key, pair)
      }
      setRows([...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat riwayat absensi')
    } finally {
      setLoading(false)
    }
  }, [endDate, projectId, startDate])

  useEffect(() => {
    const timeout = window.setTimeout(loadHistory, 0)
    return () => window.clearTimeout(timeout)
  }, [loadHistory])

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-800 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-2xl bg-slate-900 p-5 text-white shadow-lg">
          <button onClick={() => router.push('/user')} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"><ArrowLeft className="h-4 w-4" /> Kembali ke Absensi</button>
          <div className="flex items-center gap-3"><CalendarDays className="h-7 w-7 text-emerald-400" /><div><h1 className="text-2xl font-bold">Riwayat Absensi</h1><p className="text-sm text-slate-300">{projectName}</p></div></div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">{(['day', 'week', 'month', 'custom'] as Period[]).map(value => <button key={value} onClick={() => selectPeriod(value)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${period === value ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{value === 'day' ? 'Hari Ini' : value === 'week' ? '1 Minggu' : value === 'month' ? '1 Bulan' : 'Custom'}</button>)}</div>
          {period === 'custom' && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Tanggal Mulai<input type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold">Tanggal Selesai<input type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label></div>}
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Nama</th><th className="px-4 py-3">Jabatan</th><th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Masuk</th><th className="px-4 py-3">Pulang</th><th className="px-4 py-3">Metode</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">Memuat...</td></tr> : !rows.length ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">Tidak ada absensi pada rentang ini.</td></tr> : rows.map(row => <tr key={row.key} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{row.name}</td><td className="px-4 py-3">{row.position}</td><td className="px-4 py-3 whitespace-nowrap">{new Date(`${row.date}T00:00:00`).toLocaleDateString('id-ID')}</td><td className="px-4 py-3 font-mono text-emerald-700">{row.clockIn}</td><td className="px-4 py-3 font-mono text-red-600">{row.clockOut}</td><td className="px-4 py-3 capitalize">{row.method}</td></tr>)}</tbody></table></div></section>
      </div>
    </main>
  )
}
