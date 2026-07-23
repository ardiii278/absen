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
    <header className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{projectName}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              <span className="font-mono">{timeStr} WIB</span>
            </div>
            <div className="flex items-center gap-1.5">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs font-semibold text-emerald-600">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-600">Offline Mode</span>
                </>
              )}
              {queuedCount > 0 && (
                <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {queuedCount} antrean
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={onOvertimeClick} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600">
            <Clock3 className="h-4 w-4" /> Pengajuan Lembur
          </button>
          <button
            onClick={onRegisterClick}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition"
          >
            <UserPlus className="w-4 h-4" />
            Tambah Pekerja
          </button>
          <button
            onClick={onHistoryClick}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition"
          >
            <List className="w-4 h-4" />
            Riwayat Absensi
          </button>
        </div>
      </div>
    </header>
  )
}
