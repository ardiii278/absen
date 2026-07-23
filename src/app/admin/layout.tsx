'use client'

import React, { useEffect, useState } from 'react'
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
  Shield
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface AdminLayoutProps {
  children: React.ReactNode
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/login')
          return
        }

        setAdminEmail(session.user.email || 'Admin')

        // Fetch user role
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle()

        if (!profile || (profile.role !== 'super_admin' && profile.role !== 'admin')) {
          // If not admin/super_admin, sign out and redirect
          await supabase.auth.signOut()
          router.push('/login')
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
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const menuItems = [
    {
      name: 'Monitoring Dashboard',
      path: '/admin/monitoring',
      icon: LayoutDashboard
    },
    {
      name: 'Proyek & Lokasi',
      path: '/admin/projects',
      icon: Shield
    },
    {
      name: 'Akun Kiosk',
      path: '/admin/kiosk-accounts',
      icon: Smartphone
    },
    {
      name: 'Persetujuan Pekerja',
      path: '/admin/workers',
      icon: Users
    },
    {
      name: 'Absensi & Konflik',
      path: '/admin/attendance',
      icon: CheckSquare
    },
    {
      name: 'Pengajuan Lembur',
      path: '/admin/overtime',
      icon: Clock
    },
    {
      name: 'Rekap Payroll',
      path: '/admin/payroll',
      icon: DollarSign
    },
    {
      name: 'Ekspor & Backup',
      path: '/admin/exports',
      icon: Download
    },
    {
      name: 'Histori Error',
      path: '/admin/error-logs',
      icon: Shield
    }
  ]

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 font-semibold text-sm">Memeriksa Otorisasi...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col justify-between shrink-0 shadow-xl">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <Shield className="w-8 h-8 text-emerald-500" />
            <div>
              <h2 className="font-bold text-lg leading-tight text-white">Absensi Admin</h2>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                {role === 'super_admin' ? 'Super Admin' : 'Admin Proyek'}
              </span>
            </div>
          </div>

          <nav className="space-y-1.5">
            {menuItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.path}
                  href={item.path}
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
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-red-900 hover:text-white rounded-xl text-sm font-bold transition text-slate-350"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
