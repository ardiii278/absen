'use client'

import React from 'react'
import { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color?: 'emerald' | 'blue' | 'amber' | 'red' | 'slate'
  loading?: boolean
  onClick?: () => void
}

const colorMap = {
  emerald: {
    chip: 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-600/30',
    accent: 'from-emerald-500/60'
  },
  blue: {
    chip: 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-600/30',
    accent: 'from-blue-500/60'
  },
  amber: {
    chip: 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-amber-500/30',
    accent: 'from-amber-400/60'
  },
  red: {
    chip: 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-600/30',
    accent: 'from-red-500/60'
  },
  slate: {
    chip: 'bg-gradient-to-br from-slate-500 to-slate-600 shadow-slate-600/30',
    accent: 'from-slate-400/60'
  }
}

export default function MetricCard({ label, value, icon: Icon, color = 'emerald', loading, onClick }: MetricCardProps) {
  const colors = colorMap[color]

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={event => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
      className={`card relative overflow-hidden p-5 flex items-center gap-4 ${
        onClick
          ? 'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
          : ''
      }`}
    >
      <span className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${colors.accent} to-transparent`} />
      <div className={`p-3 rounded-xl text-white shadow-lg ${colors.chip}`}>
        <Icon className="w-5 h-5" strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <p className="text-slate-400 dark:text-slate-500 text-[11px] font-semibold uppercase tracking-widest truncate">{label}</p>
        {loading ? (
          <div className="h-7 w-16 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mt-1.5" />
        ) : (
          <p className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mt-0.5 truncate">{value}</p>
        )}
      </div>
    </div>
  )
}
