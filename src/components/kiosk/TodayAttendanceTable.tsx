'use client'

import { KioskAttendancePair } from '@/types/kiosk'

interface TodayAttendanceTableProps {
  pairs: Array<KioskAttendancePair & { local_date: string }>
  loading: boolean
  period: 'day' | 'week' | 'month'
  onPeriodChange: (period: 'day' | 'week' | 'month') => void
}

const periodLabels = {
  day: 'Hari',
  week: 'Minggu',
  month: 'Bulan'
} as const

export default function TodayAttendanceTable({ pairs, loading, period, onPeriodChange }: TodayAttendanceTableProps) {
  const showDate = period !== 'day'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-bold text-slate-900">Riwayat Absensi</h2>
        <div className="inline-flex w-fit rounded-lg bg-slate-100 p-1" aria-label="Periode riwayat absensi">
          {(Object.keys(periodLabels) as Array<keyof typeof periodLabels>).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => onPeriodChange(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${period === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {periodLabels[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
              <th className="py-2 px-3">Nama</th>
              <th className="py-2 px-3">Jabatan</th>
              {showDate && <th className="py-2 px-3">Tanggal</th>}
              <th className="py-2 px-3">Masuk</th>
              <th className="py-2 px-3">Pulang</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Metode</th>
              <th className="py-2 px-3">Sync</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={showDate ? 8 : 7} className="py-8 text-center text-slate-400 text-xs">Memuat...</td></tr>
            ) : pairs.length === 0 ? (
              <tr><td colSpan={showDate ? 8 : 7} className="py-8 text-center text-slate-400 text-xs">Belum ada absensi pada periode ini.</td></tr>
            ) : (
              pairs.map(p => (
                <tr key={`${p.worker_id}:${p.local_date}`} className="border-t border-slate-50 hover:bg-slate-50 transition">
                  <td className="py-2 px-3">
                    <div className="font-semibold text-xs text-slate-800 truncate max-w-[120px]">{p.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{p.nik}</div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700">
                      {p.position || '-'}
                    </span>
                  </td>
                  {showDate && (
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-slate-600">
                      {new Date(`${p.local_date}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                  )}
                  <td className="py-2 px-3 text-xs font-mono text-slate-600">
                    {p.clock_in || '-'}
                  </td>
                  <td className="py-2 px-3 text-xs font-mono text-slate-600">
                    {p.clock_out || '-'}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`text-xs font-bold ${p.status_day >= 1 ? 'text-emerald-600' : p.status_day > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {p.status_day.toFixed(1)}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      p.method === 'face' ? 'bg-blue-50 text-blue-700'
                        : p.method === 'manual' ? 'bg-amber-50 text-amber-700'
                        : 'bg-purple-50 text-purple-700'
                    }`}>
                      {p.method}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`w-2 h-2 rounded-full inline-block ${p.synced ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      title={p.synced ? 'Synced' : 'Pending Sync'} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
