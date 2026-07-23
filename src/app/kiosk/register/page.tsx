'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function KioskRegisterPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/kiosk')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-400 text-sm">Mengalihkan...</p>
    </div>
  )
}
