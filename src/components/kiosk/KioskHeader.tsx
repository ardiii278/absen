'use client'

import { useState, useEffect } from 'react'
import { UserPlus, List, Wifi, WifiOff, Clock, Clock3 } from 'lucide-react'

interface KioskHeaderProps {
  projectName: string
  isOnline: boolean
  queuedCount: number
  onRegisterClick: () => void
  onHistoryClick: () => void
  onOvertimeClick: () => void
}

function getWIBTime(date: Date): string {
  return date.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function KioskHeader({ projectName, isOnline, queuedCount, onRegisterClick, onHistoryClick, onOvertimeClick }: KioskHeaderProps) {
  const [timeStr, setTimeStr] = useState('')

  useEffect(() => {
    const update = () => setTimeStr(getWIBTime(new Date()))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white shadow-lg shadow-slate-900/20 p-5 md:p-6 mb-6">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{projectName}</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${
                isOnline
                  ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
                  : 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>
            {queuedCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30 text-[11px] px-2.5 py-1 font-bold">
                {queuedCount} antrean
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-sm text-slate-300">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span className="font-mono tabular-nums">{timeStr} WIB</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onOvertimeClick}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-sm shadow-amber-900/30 transition hover:from-amber-300 hover:to-amber-400 active:scale-[0.98]"
          >
            <Clock3 className="h-4 w-4" /> Pengajuan Lembur
          </button>
          <button
            onClick={onRegisterClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-semibold transition ring-1 ring-inset ring-white/20 active:scale-[0.98]"
          >
            <UserPlus className="w-4 h-4" />
            Tambah Pekerja
          </button>
          <button
            onClick={onHistoryClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-semibold transition ring-1 ring-inset ring-white/20 active:scale-[0.98]"
          >
            <List className="w-4 h-4" />
            Riwayat Absensi
          </button>
        </div>
      </div>
    </header>
  )
}
