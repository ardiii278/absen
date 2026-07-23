'use client'

import React from 'react'
import { ApprovalStatus, AttendanceType } from '@/types'

interface StatusBadgeProps {
  status: ApprovalStatus
  size?: 'xs' | 'sm'
}

const statusConfig: Record<ApprovalStatus, { label: string; classes: string }> = {
  pending_approval: {
    label: 'Menunggu Approval',
    classes: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  },
  approved: {
    label: 'Disetujui',
    classes: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  },
  rejected: {
    label: 'Ditolak',
    classes: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  }
}

export function StatusBadge({ status, size = 'xs' }: StatusBadgeProps) {
  const config = statusConfig[status]
  const sizeClass = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'

  return (
    <span className={`${sizeClass} rounded-full font-semibold ${config.classes}`}>
      {config.label}
    </span>
  )
}

interface AttendanceTypeBadgeProps {
  type: AttendanceType
}

export function AttendanceTypeBadge({ type }: AttendanceTypeBadgeProps) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
      type === 'in'
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
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
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
      source === 'face'
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
    }`}>
      {source === 'face' ? 'Face Scan' : 'Manual'}
    </span>
  )
}
