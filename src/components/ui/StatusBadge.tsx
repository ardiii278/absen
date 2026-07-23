'use client'

import React from 'react'
import { ApprovalStatus, AttendanceType } from '@/types'

interface StatusBadgeProps {
  status: ApprovalStatus
  size?: 'xs' | 'sm'
}

const statusConfig: Record<ApprovalStatus, { label: string; classes: string; dot: string }> = {
  pending_approval: {
    label: 'Menunggu Approval',
    classes: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-400/20',
    dot: 'bg-amber-500'
  },
  approved: {
    label: 'Disetujui',
    classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20',
    dot: 'bg-emerald-500'
  },
  rejected: {
    label: 'Ditolak',
    classes: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-400/20',
    dot: 'bg-red-500'
  }
}

export function StatusBadge({ status, size = 'xs' }: StatusBadgeProps) {
  const config = statusConfig[status]
  const sizeClass = size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'

  return (
    <span className={`inline-flex items-center gap-1.5 ${sizeClass} rounded-full font-semibold ring-1 ring-inset ${config.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  )
}

interface AttendanceTypeBadgeProps {
  type: AttendanceType
}

export function AttendanceTypeBadge({ type }: AttendanceTypeBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide ring-1 ring-inset ${
      type === 'in'
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20'
        : 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-400/20'
    }`}>
      {type === 'in' ? 'MASUK' : 'PULANG'}
    </span>
  )
}

interface SourceBadgeProps {
  source: string | null
}

export function SourceBadge({ source }: SourceBadgeProps) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
      source === 'face'
        ? 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-400/20'
        : 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-400/20'
    }`}>
      {source === 'face' ? 'Face Scan' : 'Manual'}
    </span>
  )
}
