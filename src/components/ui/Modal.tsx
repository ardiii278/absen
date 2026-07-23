'use client'

import React from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl'
}

export default function Modal({ isOpen, onClose, title, subtitle, children, maxWidth = 'md' }: ModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-up"
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200/60 dark:border-slate-700/60 ${maxWidthClasses[maxWidth]} w-full max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700/60 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="p-1.5 -m-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
