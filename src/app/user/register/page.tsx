'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import UserHeader from '@/components/user/UserHeader'
import RegisterWorkerModal from '@/components/user/RegisterWorkerModal'

export default function UserRegisterPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [projectName, setProjectName] = useState('Memuat Proyek...')
  const [isOnline, setIsOnline] = useState(true)

  const fetchProjectDetails = useCallback(async (pId: string) => {
    const { data } = await supabase.from('projects').select('name').eq('id', pId).maybeSingle()
    if (data) setProjectName(data.name)
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('kiosk_project_id')
    if (!stored) {
      router.replace('/login')
      return
    }

    const timeout = setTimeout(() => {
      setMounted(true)
      setIsOnline(navigator.onLine)
      fetchProjectDetails(stored)
    }, 0)
    
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearTimeout(timeout)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [router, fetchProjectDetails])

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
    <main className="min-h-screen bg-slate-100 p-4 md:p-6 text-slate-800">
      <div className="max-w-5xl mx-auto space-y-6">
        <UserHeader
          projectName={projectName}
          isOnline={isOnline}
          queuedCount={0}
          isRegisterPage
          onHistoryClick={() => router.replace('/user')}
          onOvertimeClick={() => router.replace('/user')}
        />
        
        <div className="card p-6 md:p-8 bg-white rounded-2xl shadow-sm border border-slate-200/60">
          <RegisterWorkerModal
            isOpen={false}
            isInline
            projectId={projectId}
            onClose={() => router.replace('/user')}
          />
        </div>
      </div>
    </main>
  )
}
