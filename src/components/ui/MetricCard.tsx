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
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    icon: 'text-emerald-600 dark:text-emerald-400',
    value: 'text-emerald-800 dark:text-emerald-200'
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    icon: 'text-blue-600 dark:text-blue-400',
    value: 'text-blue-800 dark:text-blue-200'
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    icon: 'text-amber-600 dark:text-amber-400',
    value: 'text-amber-800 dark:text-amber-200'
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    icon: 'text-red-600 dark:text-red-400',
    value: 'text-red-800 dark:text-red-200'
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-700/50',
    icon: 'text-slate-600 dark:text-slate-400',
    value: 'text-slate-800 dark:text-slate-200'
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
      className={`bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500' : ''}`}
    >
      <div className={`p-3 rounded-xl ${colors.bg}`}>
        <Icon className={`w-6 h-6 ${colors.icon}`} />
      </div>
      <div>
        <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider">{label}</p>
        {loading ? (
          <div className="h-8 w-16 bg-slate-100 dark:bg-slate-700 rounded animate-pulse mt-1" />
        ) : (
          <p className={`text-2xl font-bold ${colors.value} mt-0.5`}>{value}</p>
        )}
      </div>
    </div>
  )
}
