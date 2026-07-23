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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-900">
        <div className="h-8 w-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
        <div className="text-slate-500 dark:text-slate-400 font-semibold text-sm">Memeriksa Otorisasi...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-900 font-sans">
      {mobileMenuOpen && (
        <button
          aria-label="Tutup menu navigasi"
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-[268px] bg-slate-950 text-slate-100 flex flex-col justify-between shrink-0 shadow-2xl transition-transform duration-300 md:static md:translate-x-0 border-r border-slate-800/60`}>
        <div className="p-5 overflow-y-auto">
          <div className="flex items-center gap-3 mb-8 px-1 pt-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/50">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-[15px] leading-tight text-white tracking-tight">Absensi Admin</h2>
              <span className="text-[10px] text-emerald-400/90 font-semibold tracking-widest uppercase">
                {role === 'super_admin' ? 'Super Admin' : 'Admin Proyek'}
              </span>
            </div>
            <button aria-label="Tutup menu" onClick={() => setMobileMenuOpen(false)} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition md:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <p className="px-3 pb-2 text-[10px] uppercase font-bold text-slate-500 tracking-widest">Menu Utama</p>
          <nav className="space-y-0.5">
            {menuItems.map((item) => {
              const Icon = item.icon
              const itemPath = item.path.split('?')[0]
              const isActive = pathname === itemPath
              return (
                <Link
                  key={item.path + item.name}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-emerald-600/15 text-emerald-300'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                  }`}
                >
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-emerald-500" />}
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span className="flex-1 leading-snug">{item.name}</span>
                  {item.badge !== undefined && (
                    <span className="min-w-5 h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm shadow-red-900/50">
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="pt-4 mt-2">
              <p className="px-3 pb-2 text-[10px] uppercase font-bold text-slate-500 tracking-widest">Lainnya</p>
            </div>

            {utilityItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.path + item.name}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-emerald-600/15 text-emerald-300'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                  }`}
                >
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-emerald-500" />}
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span>{item.name}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/70 bg-slate-900/50">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2 mb-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700 text-emerald-400 text-sm font-bold uppercase">
              {(adminEmail || 'A').charAt(0)}
            </div>
            <div className="truncate">
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Masuk sebagai</p>
              <p className="text-[13px] font-semibold text-slate-200 truncate" title={adminEmail || ''}>
                {adminEmail}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800/80 hover:bg-red-500/15 hover:text-red-300 rounded-xl text-[13px] font-bold transition text-slate-300 ring-1 ring-slate-700/60 hover:ring-red-500/30"
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
          className="fixed bottom-5 right-5 z-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 text-white shadow-lg shadow-emerald-900/40 active:scale-95 transition md:hidden"
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
