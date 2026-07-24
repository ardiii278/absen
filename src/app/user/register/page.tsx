'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import RegisterWorkerModal from '@/components/user/RegisterWorkerModal'

export default function UserRegisterPage() {
  const router = useRouter()
  const projectId = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem('kiosk_project_id'),
    () => null
  )

  useEffect(() => {
    if (!projectId) router.replace('/login')
  }, [projectId, router])

  return (
    <main className="min-h-screen bg-slate-100">
      {projectId && (
        <RegisterWorkerModal
          isOpen
          projectId={projectId}
          onClose={() => router.replace('/user')}
        />
      )}
    </main>
  )
}
