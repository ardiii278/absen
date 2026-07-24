'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import RegisterWorkerModal from '@/components/user/RegisterWorkerModal'

export default function UserRegisterPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setMounted(true)
    }, 0)
    const stored = localStorage.getItem('kiosk_project_id')
    if (!stored) {
      router.replace('/login')
    }
    return () => clearTimeout(timeout)
  }, [router])

  if (!mounted) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Mengalihkan...</p>
      </main>
    )
  }

  const projectId = localStorage.getItem('kiosk_project_id')

  if (!projectId) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Mengalihkan...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <RegisterWorkerModal
        isOpen
        projectId={projectId}
        onClose={() => router.replace('/user')}
      />
    </main>
  )
}
