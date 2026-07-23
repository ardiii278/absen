'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  Clock,
  DollarSign,
  Download,
  LogOut,
  Smartphone,
  Shield,
  FolderKanban
  , Menu, X
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ThemeProvider } from '@/components/ThemeProvider'
import { FilterProvider, useGlobalFilter } from '@/components/FilterContext'
import Topbar from '@/components/layout/Topbar'

interface AdminLayoutProps {
  children: React.ReactNode
}

function AdminLayoutInner({ children }: AdminLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { projectId, jobScope, setProjectId, setJobScope } = useGlobalFilter()

  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) return

    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/admin/login')
          return
        }

        setAdminEmail(session.user.email || 'Admin')

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle()

        if (!profile || (profile.role !== 'super_admin' && profile.role !== 'admin')) {
          await supabase.auth.signOut()
          router.push('/admin/login')
          return
        }

        setRole(profile.role)
      } catch {
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [router, isLoginPage])

  const fetchPendingCount = useCallback(async () => {
    const { count } = await supabase
      .from('workers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval')
    setPendingCount(count || 0)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchPendingCount()
    }, 0)
    const interval = setInterval(fetchPendingCount, 30000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [fetchPendingCount])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const menuItems = [
    {
      name: 'Ringkasan',
      path: '/admin/monitoring',
      icon: LayoutDashboard
    },
    {
      name: 'Master Data Pekerja',
      path: '/admin/workers',
      icon: Users
    },
    {
      name: 'Persetujuan Pekerja Baru',
      path: '/admin/workers?filter=pending',
      icon: Users,
      badge: pendingCount > 0 ? pendingCount : undefined
    },
    {
      name: 'Approval & Koreksi Absensi',
      path: '/admin/attendance',
      icon: CheckSquare
    },
    {
      name: 'Permohonan Lembur',
      path: '/admin/overtime',
      icon: Clock
    },
    {
      name: 'Rekap, Export & Backup',
      path: '/admin/exports',
      icon: Download
    },
    {
      name: 'Pengaturan Akun Kiosk',
      path: '/admin/kiosk-accounts',
      icon: Smartphone
    },
    {
      name: 'Pengaturan Proyek',
      path: '/admin/projects',
      icon: FolderKanban
    }
  ]

  const utilityItems = [
    {
      name: 'Rekap Payroll',
      path: '/admin/payroll',
      icon: DollarSign
    },
    {
      name: 'Histori Error',
      path: '/admin/error-logs',
      icon: Shield
    }
  ]

  if (isLoginPage) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-slate-500 dark:text-slate-400 font-semibold text-sm">Memeriksa Otorisasi...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-900 font-sans">
      {mobileMenuOpen && (
        <button
          aria-label="Tutup menu navigasi"
          className="fixed inset-0 z-30 bg-slate-950/60 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 dark:bg-slate-950 text-slate-100 flex flex-col justify-between shrink-0 shadow-xl transition-transform md:static md:translate-x-0`}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <Shield className="w-8 h-8 text-emerald-500" />
            <div>
              <h2 className="font-bold text-lg leading-tight text-white">Absensi Admin</h2>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                {role === 'super_admin' ? 'Super Admin' : 'Admin Proyek'}
              </span>
            </div>
            <button aria-label="Tutup menu" onClick={() => setMobileMenuOpen(false)} className="ml-auto text-slate-400 md:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon
              const itemPath = item.path.split('?')[0]
              const isActive = pathname === itemPath
              return (
                <Link
                  key={item.path + item.name}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                    isActive
                      ? 'bg-emerald-700 text-white shadow-md'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{item.name}</span>
                  {item.badge !== undefined && (
                    <span className="w-5 h-5 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="pt-3 mt-3 border-t border-slate-800">
              <p className="px-4 py-1 text-[10px] uppercase font-bold text-slate-600 tracking-wider">Lainnya</p>
            </div>

            {utilityItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.path + item.name}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                    isActive
                      ? 'bg-emerald-700 text-white shadow-md'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="p-6 border-t border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="truncate pr-2">
              <p className="text-xs text-slate-400 font-medium">Logged in as</p>
              <p className="text-sm font-bold text-white truncate" title={adminEmail || ''}>
                {adminEmail}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-red-900 hover:text-white rounded-xl text-sm font-bold transition text-slate-300"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <button
          aria-label="Buka menu navigasi"
          onClick={() => setMobileMenuOpen(true)}
          className="fixed bottom-5 right-5 z-20 rounded-full bg-emerald-700 p-4 text-white shadow-lg md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Topbar
          pendingApprovalCount={pendingCount}
          selectedProjectId={projectId}
          onProjectChange={setProjectId}
          selectedJobScope={jobScope}
          onJobScopeChange={setJobScope}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <ThemeProvider>
      <FilterProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </FilterProvider>
    </ThemeProvider>
  )
}
